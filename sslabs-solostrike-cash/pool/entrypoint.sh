#!/usr/bin/env bash
# LoneStrike Cash — pool entrypoint
# The BCH payout address is read from a shared file the dashboard can write
# (/pool/config/bch_address). We supervise asicseer-pool and restart it whenever
# the address changes, so the address can be set from the UI with no redeploy.
set -uo pipefail

mkdir -p /pool/logs /pool/config
ADDR_FILE=/pool/config/bch_address
RESET_FILE=/pool/config/reset_request
DIFF_FILE=/pool/config/diff

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
  local mind=1 startd=42 maxd=0 maxline=""
  if [ -f "$DIFF_FILE" ]; then
    read -r mind startd maxd < "$DIFF_FILE" 2>/dev/null || true
    case "$mind" in ''|*[!0-9]*) mind=1;; esac
    case "$startd" in ''|*[!0-9]*) startd=42;; esac
    case "$maxd" in ''|*[!0-9]*) maxd=0;; esac
  fi
  if [ "$maxd" -gt 0 ] 2>/dev/null; then
    maxline="\"maxdiff\": ${maxd},"
  fi
  # Idle-client reaping: close TCP-dead / half-open miners so they auto-reconnect
  # instead of lingering as zombie workers. asicseer-pool's "blocking_timeout" is
  # the seconds to wait for a client to respond at the TCP level before closing it
  # (default 60; must stay >= 10). Tunable via /pool/config/blocking_timeout.
  local btimeout=30
  if [ -f /pool/config/blocking_timeout ]; then
    read -r btimeout < /pool/config/blocking_timeout 2>/dev/null || btimeout=30
    case "$btimeout" in ''|*[!0-9]*) btimeout=30;; esac
    [ "$btimeout" -lt 10 ] 2>/dev/null && btimeout=10
  fi
  cat > /pool/asicseer-pool.conf <<JSON
{
  "btcd": [ ${btcd} ],
  "bchaddress": "${addr}",
  "bchsig": "/LoneStrike Cash/",
  "pool_fee": 0.0,
  "disable_dev_donation": true,
  "serverurl": "0.0.0.0:3333",
  "mindiff": ${mind},
  "startdiff": ${startd},
  ${maxline}
  "blocking_timeout": ${btimeout},
  "logdir": "/pool/logs"
}
JSON
}

POOL_PID=""
start_pool() {
  local addr="$1"
  if [ -z "$addr" ]; then
    echo "[LoneStrike Cash] No BCH address set yet — open the dashboard and enter one. Waiting…"
    POOL_PID=""
    return 0
  fi
  write_conf "$addr"
  echo "[LoneStrike Cash] starting asicseer-pool (solo) -> ${RPC_HOST}:${RPC_PORT}; payout ${addr}"
  local lflag=""; [ -f /pool/config/logshares ] && lflag="-L"
  asicseer-pool -B $lflag -c /pool/asicseer-pool.conf &
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

do_reset() {
  local scope="$1"
  echo "[LoneStrike Cash] reset best requested: ${scope}"
  stop_pool
  if [ "$scope" = "all" ]; then
    find /pool/logs -type f 2>/dev/null | while read -r fp; do
      sed -i -E 's/"best(share|ever)" *: *[0-9.eE+\-]+/"best\1": 0/g' "$fp" 2>/dev/null || true
    done
  else
    # surgical per-worker reset: dashboard (Node) edits only this worker's JSON
    touch /pool/config/pool_stopped
    i=0
    while [ $i -lt 25 ] && [ ! -f /pool/config/edit_done ]; do
      sleep 1; i=$((i+1))
    done
    rm -f /pool/config/pool_stopped /pool/config/edit_done
  fi
  rm -f "$RESET_FILE"
  start_pool "$CUR_ADDR"
}

CUR_ADDR="$(read_addr)"
start_pool "$CUR_ADDR"

# Supervisor loop: apply address changes, and revive the pool if it dies.
while true; do
  sleep 5
  if [ -f "$RESET_FILE" ]; then
    do_reset "$(tr -d '\r\n' < "$RESET_FILE")"
  fi
  NEW_DIFF="$(cat "$DIFF_FILE" 2>/dev/null || true)"
  if [ "$NEW_DIFF" != "${CUR_DIFF:-}" ]; then
    CUR_DIFF="$NEW_DIFF"
    if [ -n "${FIRST_DIFF_SEEN:-}" ]; then
      echo "[LoneStrike Cash] difficulty change detected ($NEW_DIFF) — restarting pool"
      stop_pool
      start_pool "$CUR_ADDR"
    fi
  fi
  FIRST_DIFF_SEEN=1
  NEW_LS="$( [ -f /pool/config/logshares ] && echo on || echo off )"
  if [ "$NEW_LS" != "${CUR_LS:-}" ]; then
    CUR_LS="$NEW_LS"
    if [ -n "${FIRST_LS_SEEN:-}" ]; then
      echo "[LoneStrike Cash] share logging toggled ($NEW_LS) — restarting pool"
      stop_pool
      start_pool "$CUR_ADDR"
    fi
  fi
  FIRST_LS_SEEN=1
  NEW_ADDR="$(read_addr)"
  if [ "$NEW_ADDR" != "$CUR_ADDR" ]; then
    echo "[LoneStrike Cash] address changed -> '${NEW_ADDR}'; restarting pool"
    stop_pool
    CUR_ADDR="$NEW_ADDR"
    start_pool "$CUR_ADDR"
  elif [ -n "$CUR_ADDR" ] && { [ -z "$POOL_PID" ] || ! kill -0 "$POOL_PID" 2>/dev/null; }; then
    echo "[LoneStrike Cash] pool not running; (re)starting"
    start_pool "$CUR_ADDR"
  fi
done
