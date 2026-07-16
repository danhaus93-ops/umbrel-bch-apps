#!/usr/bin/env bash
# LoneStrike Cash — SV2 block-safety preflight.
#
# Answers one question: if a block is found RIGHT NOW, will it be kept?
# Walks the whole chain: node tip -> templates -> pool -> payout script ->
# persistence. Read-only. Safe to run any time. Needs bash + docker only.
#
#   bash sv2-preflight.sh
APP=sslabs-solostrike-cash
NODE=sslabs-bitcoin-cash-node
RPCUSER="${RPCUSER:-bchn}"
RPCPASS="${RPCPASS:-bchn_local_rpc_pw_2f9c}"
PASS=0; FAIL=0; WARN=0
ok(){   echo "  PASS  $1"; PASS=$((PASS+1)); }
bad(){  echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
warn(){ echo "  WARN  $1"; WARN=$((WARN+1)); }
cli(){ sudo docker exec ${NODE}_bitcoind_1 bitcoin-cli -rpcuser="$RPCUSER" -rpcpassword="$RPCPASS" "$@" 2>/dev/null; }
blog(){ sudo docker logs --tail "${2:-400}" ${APP}_$1 2>&1; }
# The entrypoint banner (payout script, coinbase tag, extranonce2) prints ONCE
# at container start, so it lives at the HEAD of the log and scrolls out of any
# --tail window within hours. Grepping the tail for it reported "no payout
# script" on a pool that was demonstrably serving a client. Head for the
# banner, tail for runtime errors.
bhead(){ sudo docker logs ${APP}_$1 2>&1 | head -"${2:-80}"; }

echo "=============================================="
echo " SV2 block-safety preflight"
echo "=============================================="

echo; echo "[1/7] Node: are templates built on the LIVE tip?"
CI=$(cli getblockchaininfo)
B=$(echo "$CI" | grep -o '"blocks": *[0-9]*' | grep -o '[0-9]*')
H=$(echo "$CI" | grep -o '"headers": *[0-9]*' | grep -o '[0-9]*')
IBD=$(echo "$CI" | grep -o '"initialblockdownload": *[a-z]*' | awk '{print $2}')
if [ -z "$B" ]; then bad "bitcoind not answering RPC — mining is pointless until it is"
elif [ "$IBD" = "true" ]; then bad "node still in initial block download (blocks=$B)"
elif [ "$B" != "$H" ]; then bad "node behind: blocks=$B headers=$H — blocks found now get orphaned"
else ok "tip live and synced (height $B)"; fi
OUT=$(cli getpeerinfo | grep -c '"inbound": false')
[ "${OUT:-0}" -ge 1 ] && ok "outbound peers: $OUT" \
  || bad "ZERO outbound peers — node cannot hear new blocks (check Tor mode)"

echo; echo "[2/7] Bridge: templates flowing, and to a client?"
BL=$(blog sv2-bridge_1 200)
TH=$(echo "$BL" | grep -o 'h[0-9]\{6,\}' | tail -1 | tr -d h)
if [ -z "$TH" ]; then bad "no templates in the bridge log"
elif [ -n "$B" ] && [ "$TH" -ge "$((B+1))" ]; then ok "templates at h$TH (tip+1) — building on the live tip"
else bad "templates at h$TH but tip is $B — bridge is behind, blocks would be stale"; fi
CL=$(echo "$BL" | grep -o '\-> [0-9]* client' | tail -1 | grep -o '[0-9]*')
[ "${CL:-0}" -ge 1 ] && ok "pool connected to bridge ($CL client)" \
  || bad "0 clients — sv2-pool is NOT receiving templates"

echo; echo "[3/7] Never-lose-a-block: persistence armed?"
D=~/umbrel/app-data/$APP/data/sv2/pending_blocks
if [ ! -d "$D" ]; then bad "pending_blocks missing — a found block would NOT be saved to disk"
else
  ok "pending_blocks exists"
  N=$(sudo ls -1 "$D"/*.hex 2>/dev/null | wc -l)
  if [ "$N" -gt 0 ]; then
    bad "*** $N UNSUBMITTED BLOCK(S) ON DISK ***"
    sudo ls -l "$D"/*.hex 2>/dev/null | sed 's/^/        /'
    echo "        -> the node never judged these. Do NOT delete them."
    echo "        -> the bridge retries every 60s; check the node is up."
  else ok "no unjudged blocks pending (this is what you want)"; fi
fi
echo "$BL" | grep -q "not writable" && bad "bridge cannot write pending_blocks (permissions)" \
  || ok "no persistence permission errors"

echo; echo "[4/7] Coinbase: would the reward actually be spendable?"
PL=$(blog sv2-pool_1 400)
PH=$(bhead sv2-pool_1 80)
PS=$(echo "$PH" | grep -o 'payout script: raw([0-9a-f]*)' | tail -1)
if [ -z "$PS" ]; then
  if [ "${CL:-0}" -ge 1 ]; then
    warn "payout banner not in the log (rotated out), but the pool is serving $CL client — it bootstrapped, so a payout script exists"
  else bad "no payout script and 0 clients — SV2 is idle (set the address on the SV2 card)"; fi
else
  HEX=$(echo "$PS" | grep -o '[0-9a-f]\{20,\}')
  case "$HEX" in
    76a914*88ac) ok "payout = P2PKH, 20-byte hash (spendable)" ;;
    a914*87)     ok "payout = P2SH, 20-byte hash (spendable)" ;;
    *)           bad "UNRECOGNISED payout script: $HEX — do not mine on this" ;;
  esac
fi
echo "$PH$PL" | grep -q "address .* rejected:" && bad "payout address was REJECTED — SV2 is idle" \
  || ok "payout address accepted"
TAG=$(echo "$PH" | grep -o 'coinbase tag: [^ ]*' | tail -1)
[ -n "$TAG" ] && ok "$TAG (attribution)" || warn "coinbase tag line rotated out of the log — restart the app to re-print the banner"
XN=$(echo "$PH" | grep -o 'extranonce2 bytes: [0-9]*' | tail -1)
[ -n "$XN" ] && ok "$XN" || warn "extranonce2 line rotated out of the log — restart the app to re-print the banner"

echo; echo "[5/7] Pool health: nothing fatal in the log?"
for pat in "CoinbaseTxPrefixError" "panicked" "Shutdown" "ExtranonceAllocator"; do
  echo "$PL" | grep -qi "$pat" && bad "pool log contains '$pat'" || true
done
echo "$PL" | grep -qiE "CoinbaseTxPrefixError|panicked" || ok "no fatal pool errors"
echo "$BL" | grep -q "reconstruction warning" \
  && bad "*** reconstruction warnings — bridge/pool coinbase layout DISAGREE ***" \
  || ok "no reconstruction warnings (coinbase layout agrees)"

echo; echo "[6/7] Fast block detection (ZMQ)"
cli getzmqnotifications | grep -q hashblock && ok "ZMQ hashblock live — instant new-tip detection" \
  || warn "no ZMQ hashblock — bridge falls back to polling (slower tip switch)"

echo; echo "[7/7] Blocks found so far"
J=~/umbrel/app-data/$APP/data/sv2/sv2_blocks.jsonl
if sudo test -f "$J"; then
  echo "        $(sudo wc -l < "$J") recorded:"; sudo tail -3 "$J" | sed 's/^/        /'
else echo "        none recorded yet"; fi

echo; echo "=============================================="
printf " %d passed, %d failed, %d warnings\n" "$PASS" "$FAIL" "$WARN"
[ "$FAIL" -eq 0 ] && echo " SAFE TO MINE: a block found now would be kept." \
                  || echo " *** DO NOT RELY ON SV2 UNTIL THE FAILURES ABOVE ARE FIXED ***"
echo "=============================================="
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
