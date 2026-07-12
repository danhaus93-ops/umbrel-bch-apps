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

if [ -z "$PAYOUT_ADDRESS" ]; then
    echo "[entrypoint] ERROR: PAYOUT_ADDRESS not set"; exit 1
fi
PAYOUT_SCRIPT=$(python3 /usr/local/bin/addr_to_script.py "$PAYOUT_ADDRESS")
if [ -z "$PAYOUT_SCRIPT" ]; then
    echo "[entrypoint] ERROR: bad payout address '$PAYOUT_ADDRESS'"; exit 1
fi
echo "[entrypoint] payout script: raw($PAYOUT_SCRIPT)"

sed -e "s|__AUTH_PUB__|$PUB|" \
    -e "s|__AUTH_PRV__|$PRV|" \
    -e "s|__PAYOUT_SCRIPT__|$PAYOUT_SCRIPT|" \
    "$POOL_CFG_TEMPLATE" > "$POOL_CFG"

export SHIM_AUTH_PUB="$PUB" SHIM_AUTH_PRV="$PRV"
export BRIDGE_ADDR="${BRIDGE_ADDR:-bridge:8443}"
echo "[entrypoint] starting Noise shim"
/usr/local/bin/noise-tp-shim &
sleep 2
echo "[entrypoint] starting pool_sv2"
exec /usr/local/bin/pool_sv2 -c "$POOL_CFG"
