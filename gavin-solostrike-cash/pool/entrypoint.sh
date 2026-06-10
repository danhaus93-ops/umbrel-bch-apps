#!/usr/bin/env bash
# SoloStrike Cash — pool entrypoint
# The BCH payout address is read from a shared file the dashboard can write
# (/pool/config/bch_address). We supervise asicseer-pool and restart it whenever
# the address changes, so the address can be set from the UI with no redeploy.
set -uo pipefail

mkdir -p /pool/logs /pool/config
ADDR_FILE=/pool/config/bch_address

# Seed the address file from the env var on first run (back-compat).
if [ ! -f "$ADDR_FILE" ] && [ -n "${BCH_ADDRESS:-}" ]; then
  printf '%s' "${BCH_ADDRESS}" > "$ADDR_FILE"
fi

read_addr() {
  if [ -f "$ADDR_FILE" ]; then tr -d ' \t\r\n' < "$ADDR_FILE"; else printf '%s' "${BCH_ADDRESS:-}"; fi
}

write_conf() {
  local addr="$1" btcd
  if [ -n "${ZMQ_ENDPOINT:-}" ]; then
    btcd="{ \"url\": \"${RPC_HOST}:${RPC_PORT}\", \"auth\": \"${RPC_USER}\", \"pass\": \"${RPC_PASS}\", \"zmq\": \"${ZMQ_ENDPOINT}\" }"
  else
    btcd="{ \"url\": \"${RPC_HOST}:${RPC_PORT}\", \"auth\": \"${RPC_USER}\", \"pass\": \"${RPC_PASS}\" }"
  fi
  cat > /pool/asicseer-pool.conf <<JSON
{
  "btcd": [ ${btcd} ],
  "bchaddress": "${addr}",
  "bchsig": "/SoloStrike Cash/",
  "pool_fee": 0.0,
  "disable_dev_donation": true,
  "serverurl": "0.0.0.0:3333",
  "mindiff": 1,
  "startdiff": 42,
  "logdir": "/pool/logs"
}
JSON
}

POOL_PID=""
start_pool() {
  local addr="$1"
  if [ -z "$addr" ]; then
    echo "[SoloStrike Cash] No BCH address set yet — open the dashboard and enter one. Waiting…"
    POOL_PID=""
    return 0
  fi
  write_conf "$addr"
  echo "[SoloStrike Cash] starting asicseer-pool (solo) -> ${RPC_HOST}:${RPC_PORT}; payout ${addr}"
  asicseer-pool -B -c /pool/asicseer-pool.conf &
  POOL_PID=$!
}

stop_pool() {
  if [ -n "$POOL_PID" ] && kill -0 "$POOL_PID" 2>/dev/null; then
    kill "$POOL_PID" 2>/dev/null || true
    wait "$POOL_PID" 2>/dev/null || true
  fi
  POOL_PID=""
}
trap 'stop_pool; exit 0' TERM INT

CUR_ADDR="$(read_addr)"
start_pool "$CUR_ADDR"

# Supervisor loop: apply address changes, and revive the pool if it dies.
while true; do
  sleep 5
  NEW_ADDR="$(read_addr)"
  if [ "$NEW_ADDR" != "$CUR_ADDR" ]; then
    echo "[SoloStrike Cash] address changed -> '${NEW_ADDR}'; restarting pool"
    stop_pool
    CUR_ADDR="$NEW_ADDR"
    start_pool "$CUR_ADDR"
  elif [ -n "$CUR_ADDR" ] && { [ -z "$POOL_PID" ] || ! kill -0 "$POOL_PID" 2>/dev/null; }; then
    echo "[SoloStrike Cash] pool not running; (re)starting"
    start_pool "$CUR_ADDR"
  fi
done
