#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 gen_logs.py fixtures
node run_tests.js
# The geo table is baked into the dashboard image at docker build. Build it
# here too, so test_geo_lookup checks the real DB-IP data rather than a fixture.
# CI-only: the Umbrel host has no node (see HANDOFF 2.4).
if [ ! -f ../../dashboard/geo/geo.bin ]; then
  (cd ../../dashboard/geo \
    && npm install --no-save --no-audit --no-fund --silent world-atlas@2 topojson-client i18n-iso-countries \
    && node build-geo.js geo.bin)
fi
node test_geo_lookup.js
node test_globe_frame.js
node test_peer_disconnect.js
node test_tor_apply_label.js
node test_peer_row_stability.js
node test_sv2_saved_vs_active.js

python3 test_frame_bounds.py
python3 test_bridge_submit.py
python3 test_pool_signature.py
python3 test_extranonce2.py
python3 test_addr_to_script.py
python3 test_unified_workers.py
python3 test_celebration.py
python3 test_tor_health.py
python3 test_manifests.py
