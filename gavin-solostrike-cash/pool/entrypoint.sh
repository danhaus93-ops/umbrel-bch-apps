#!/usr/bin/env bash
set -euo pipefail
mkdir -p /pool/logs

if [ -z "${BCH_ADDRESS:-}" ]; then
  echo "[SoloStrike Cash] WARNING: BCH_ADDRESS is not set."
  echo "  Set it to your Bitcoin Cash address (bitcoincash:q... or legacy) so the"
  echo "  pool has a valid fallback/fee address. In solo mode each miner's reward"
  echo "  pays to whatever address it uses as its stratum username."
fi

# Build the bitcoind entry. If ZMQ_ENDPOINT is set, subscribe to hashblock for
# lowest-latency block notifications (implies notify:true). Otherwise fall back
# to polling.
if [ -n "${ZMQ_ENDPOINT:-}" ]; then
  echo "[SoloStrike Cash] block notifications: ZMQ ${ZMQ_ENDPOINT} (lowest latency)"
  BTCD="{ \"url\": \"${RPC_HOST}:${RPC_PORT}\", \"auth\": \"${RPC_USER}\", \"pass\": \"${RPC_PASS}\", \"zmq\": \"${ZMQ_ENDPOINT}\" }"
else
  echo "[SoloStrike Cash] block notifications: polling fallback (set ZMQ_ENDPOINT for lowest latency)"
  BTCD="{ \"url\": \"${RPC_HOST}:${RPC_PORT}\", \"auth\": \"${RPC_USER}\", \"pass\": \"${RPC_PASS}\" }"
fi

cat > /pool/asicseer-pool.conf <<JSON
{
  "btcd": [ ${BTCD} ],
  "bchaddress": "${BCH_ADDRESS:-}",
  "bchsig": "/SoloStrike Cash/",
  "pool_fee": 0.0,
  "disable_dev_donation": true,
  "serverurl": "0.0.0.0:3333",
  "mindiff": 1,
  "startdiff": 42,
  "logdir": "/pool/logs"
}
JSON

echo "[SoloStrike Cash] starting asicseer-pool in SOLO (-B) mode -> ${RPC_HOST}:${RPC_PORT}"
exec asicseer-pool -B -c /pool/asicseer-pool.conf
