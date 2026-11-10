#!/usr/bin/env bash
#
# Controlled, destructive reset of persisted e-commerce data.
#
# Without `--yes` this script only prints what would be destroyed and exits
# non-zero without changing anything.
#
# With `--yes` it runs `docker compose down -v`, which removes the containers,
# the network, AND the `ecommerce_db_data` named volume. All products and
# payments are permanently lost. It then rebuilds and starts the stack, waits
# for health, and verifies that both collections are empty.
#
# Ordinary `docker compose down`, `stop`, and `restart` do NOT remove the
# named volume and therefore preserve data. This script is the only supported
# way to start from a clean database.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BASE_URL="${BASE_URL:-http://localhost:8080}"
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-ecommerce}"
VOLUME_NAME="${COMPOSE_PROJECT}_ecommerce_db_data"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is required to run this script"
}

compose() {
  if docker info >/dev/null 2>&1; then
    docker compose "$@"
  else
    local quoted
    quoted="$(printf '%q ' docker compose "$@")"
    sg docker -c "$quoted"
  fi
}

request() {
  curl -sS --connect-timeout 3 --max-time 20 -o "$TMP_DIR/body" -w '%{http_code}' "$@"
}

usage() {
  cat <<EOF
Usage: bash scripts/reset-data.sh [--yes]

  --yes   Actually destroy the named volume and restart with an empty database.
          Without this flag nothing is changed.
EOF
}

CONFIRMED=0
for arg in "$@"; do
  case "$arg" in
    --yes) CONFIRMED=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "unknown argument: $arg" ;;
  esac
done

if [ "$CONFIRMED" -ne 1 ]; then
  cat <<EOF
This is a DESTRUCTIVE reset. It will:
  - stop and remove all stack containers and the compose network
  - DELETE the Docker named volume "$VOLUME_NAME"
    (mounted at /var/lib/postgresql/data)
  - permanently destroy every product and every payment in the database
  - rebuild the images and start the stack from a fresh, empty database

Ordinary 'docker compose down' preserves data; only 'down -v' removes the volume.

Nothing has been changed. Re-run with --yes to proceed:
  bash scripts/reset-data.sh --yes
EOF
  exit 2
fi

require curl
require jq
require docker

printf 'Resetting persisted data (destructive): removing containers, network, and volume %s\n' "$VOLUME_NAME"

compose down -v
compose up --build -d --wait

printf 'Waiting for the gateway to become healthy...\n'
start="$(date +%s)"
while :; do
  if curl -fsS --connect-timeout 2 --max-time 5 "$BASE_URL/health" >/dev/null 2>&1; then
    break
  fi
  if [ $(($(date +%s) - start)) -ge 180 ]; then
    fail "timed out waiting for the gateway after reset"
  fi
  sleep 2
done
pass "stack is healthy after reset"

status="$(request "$BASE_URL/api/products")" || fail "product list request failed"
[ "$status" = "200" ] || fail "product list returned HTTP $status after reset"
jq -e 'length == 0' "$TMP_DIR/body" >/dev/null || fail "products collection is not empty after reset"
pass "products collection is empty"

status="$(request "$BASE_URL/api/payments")" || fail "payment list request failed"
[ "$status" = "200" ] || fail "payment list returned HTTP $status after reset"
jq -e 'length == 0' "$TMP_DIR/body" >/dev/null || fail "payments collection is not empty after reset"
pass "payments collection is empty"

printf '\nReset complete: schemas were re-initialized and both collections are empty.\n'
