#!/usr/bin/env bash
# Run the backend CI test steps locally using the same Docker image as GitLab CI.
# This is meant to be run from the project root as ./scripts/ci-test-local.sh, and it will automatically find the project root and mount it into the container.
#
# This script is not used in production; it's just a local development tool.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE="registry.melroy.org/melroy/docker-images/rust:1.95-node-24.15.0"

# Use a named Docker volume for node_modules so the container gets a clean,
# writable state that is separate from the host's node_modules.
NM_VOLUME="bch-backend-node-modules"

echo "==> Using image: $IMAGE"
echo "==> Project root: $PROJECT_ROOT"
echo "==> node_modules volume: $NM_VOLUME"
echo ""

docker run --rm \
  -e CI=true \
  --user root \
  -v "$PROJECT_ROOT":/workspace \
  -v "$NM_VOLUME":/workspace/backend/node_modules \
  -w /workspace \
  "$IMAGE" \
  bash -exc "
    cd backend
    mkdir -p rust-gbt
    pnpm preinstall
    # pnpm v11 caches install state here; deleting it forces re-linking of the freshly built rust-gbt binary.
    rm -rf node_modules/.pnpm-workspace-state-v1.json
    pnpm install --prefer-offline --prefer-frozen-lockfile
    pnpm prettier:check
    pnpm test
  "
