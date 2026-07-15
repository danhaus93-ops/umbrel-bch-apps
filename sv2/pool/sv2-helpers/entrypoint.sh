#!/bin/sh
# LoneStrike Cash SV2 pool entrypoint: keygen-once, payout convert, config render, start.
set -e
DATA=/data
KEYDIR="$DATA/keys"
POOL_CFG="$DATA/pool-config.toml"
POOL_CFG_TEMPLATE=/app/pool-config.template.toml
mkdir -p "$KEYDIR"

if [ ! -f "$KEYDIR/authority.pub" ] || [ ! -f "$KEYDIR/authority.prv" ]; then
    echo "[entrypoint] first boot: generating unique authority keypair"
    OUT=$(/usr/local/bin/sri-keygen)
    echo "$OUT" | grep '^PUB=' | cut -d= -f2 > "$KEYDIR/authority.pub"
    echo "$OUT" | grep '^PRV=' | cut -d= -f2 > "$KEYDIR/authority.prv"
    chmod 600 "$KEYDIR/authority.prv"
    echo "[entrypoint] keypair generated"
else
    echo "[entrypoint] reusing existing keypair"
fi
PUB=$(cat "$KEYDIR/authority.pub")
PRV=$(cat "$KEYDIR/authority.prv")

ADDR_FILE="$DATA/payout_address"
PAYOUT="${PAYOUT_ADDRESS:-}"
[ -z "$PAYOUT" ] && [ -f "$ADDR_FILE" ] && PAYOUT=$(tr -d ' \n' < "$ADDR_FILE")
if [ -z "$PAYOUT" ]; then
    echo "[entrypoint] SV2 idle: waiting for payout address (dashboard toggle or PAYOUT_ADDRESS env)"
    while [ -z "$PAYOUT" ]; do
        sleep 10
        [ -f "$ADDR_FILE" ] && PAYOUT=$(tr -d ' \n' < "$ADDR_FILE")
    done
    echo "[entrypoint] payout address received, starting SV2"
fi
PAYOUT_ADDRESS="$PAYOUT"
PAYOUT_SCRIPT=$(python3 /usr/local/bin/addr_to_script.py "$PAYOUT_ADDRESS")
if [ -z "$PAYOUT_SCRIPT" ]; then
    echo "[entrypoint] ERROR: bad payout address '$PAYOUT_ADDRESS'"; exit 1
fi
echo "[entrypoint] payout script: raw($PAYOUT_SCRIPT)"

# --- sig-derive-start (executed verbatim by tests/sv2-telemetry) ---
# Coinbase miner tag. SRI wraps this as /<pool_signature>/<miner_tag>/ and
# hard-fails channel bootstrap (CoinbaseTxPrefixError) if the wrapped tag
# exceeds 61 bytes -- that would stop ALL mining, so cap it here.
# Must stay in sync with the "/LoneStrike Cash/" tag in pools-v2.json, which
# the BCH Explorer uses to attribute blocks to us.
SIG_DEFAULT="LoneStrike Cash"
SIG="${POOL_SIGNATURE:-$SIG_DEFAULT}"
# strip anything that could break the sed render or the TOML string; SRI
# supplies the "/" delimiters itself, so slashes are not allowed here.
SIG=$(printf '%s' "$SIG" | tr -cd 'A-Za-z0-9 ._:+-')
SIG=$(printf '%s' "$SIG" | cut -c1-40)
[ -z "$SIG" ] && SIG="$SIG_DEFAULT"
# --- sig-derive-end ---

SPM="6.0"
if [ -f "$DATA/shares_per_minute" ]; then
    CAND=$(tr -cd '0-9.' < "$DATA/shares_per_minute")
    case "$CAND" in
        ''|*..*) : ;;
        *) SPM="$CAND" ;;
    esac
fi
echo "[entrypoint] shares_per_minute=$SPM"
echo "[entrypoint] coinbase tag: /$SIG//"
sed -e "s|__AUTH_PUB__|$PUB|" \
    -e "s|__AUTH_PRV__|$PRV|" \
    -e "s|__PAYOUT_SCRIPT__|$PAYOUT_SCRIPT|" \
    -e "s|__SHARES_PER_MINUTE__|$SPM|" \
    -e "s|__POOL_SIGNATURE__|$SIG|" \
    "$POOL_CFG_TEMPLATE" > "$POOL_CFG"

export SHIM_AUTH_PUB="$PUB" SHIM_AUTH_PRV="$PRV"
export BRIDGE_ADDR="${BRIDGE_ADDR:-bridge:8443}"
echo "[entrypoint] starting Noise shim"
/usr/local/bin/noise-tp-shim &
sleep 2
# telemetry: dashboard tails this file from the shared volume
SV2_LOG="$DATA/pool_sv2.log"
touch "$SV2_LOG" && chmod 644 "$SV2_LOG"
touch "$DATA/sv2_blocks.jsonl" && chmod 666 "$DATA/sv2_blocks.jsonl"
# never-lose-a-block: the bridge (non-root uid 1000) persists candidate
# blocks here; the volume root is root-owned, so create it root-side.
mkdir -p "$DATA/pending_blocks" && chmod 777 "$DATA/pending_blocks"
( while sleep 60; do
    SZ=$(stat -c%s "$SV2_LOG" 2>/dev/null || echo 0)
    if [ "$SZ" -gt 16777216 ]; then
        # truncate IN PLACE: cat > keeps the same inode, so tee's append
        # handle stays attached. mv would strand the writer on a deleted
        # inode and blind the dashboard (learned overnight, the hard way).
        tail -c 8388608 "$SV2_LOG" > "$SV2_LOG.tmp" \
            && cat "$SV2_LOG.tmp" > "$SV2_LOG" \
            && rm -f "$SV2_LOG.tmp"
        echo "[entrypoint] rotated pool_sv2.log in place"
    fi
  done ) &
echo "[entrypoint] starting pool_sv2"
/usr/local/bin/pool_sv2 -c "$POOL_CFG" 2>&1 | tee -a "$SV2_LOG"
