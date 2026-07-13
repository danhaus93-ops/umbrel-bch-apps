#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 gen_logs.py fixtures
node run_tests.js
