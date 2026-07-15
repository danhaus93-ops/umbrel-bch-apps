#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 gen_logs.py fixtures
node run_tests.js
python3 test_bridge_submit.py
python3 test_pool_signature.py
