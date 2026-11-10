#!/usr/bin/env bash
#
# Verify that products and payments survive every ordinary restart path.
#
# This script creates one product and one successful payment, snapshots their
# API representation, then runs these cycles:
#   1. `docker compose restart` (all containers)
#   2. `docker compose stop` + `docker compose start`
#   3. `docker compose down` + `docker compose up -d --wait` (never `-v`)
#   4. `docker compose restart database` (database container only)
#
# After every cycle the product ID/name/price/stock and the payment
# ID/status/amount/card summary must be identical to the snapshot.
# The named volume is never removed by this script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BASE_URL="${BASE_URL:-http://localhost:8080}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is required to run this script"
}

require curl
require jq
require docker

# Docker may require the docker group when the current shell is not a member.
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

wait_for_gateway() {
  local label="$1"
  local timeout="${2:-120}"
  local start now
  start="$(date +%s)"

  while :; do
    if curl -fsS --connect-timeout 2 --max-time 5 "$BASE_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    now="$(date +%s)"
    if [ $((now - start)) -ge "$timeout" ]; then
      fail "timed out waiting for the gateway after $label"
    fi
    sleep 2
  done
}

wait_for_db_backed_reads() {
  local timeout="${1:-120}"
  local start now
  start="$(date +%s)"

  while :; do
    if curl -fsS --connect-timeout 2 --max-time 5 "$BASE_URL/api/products" >/dev/null 2>&1 \
      && curl -fsS --connect-timeout 2 --max-time 5 "$BASE_URL/api/payments" >/dev/null 2>&1; then
      return 0
    fi
    now="$(date +%s)"
    if [ $((now - start)) -ge "$timeout" ]; then
      fail "timed out waiting for the services to recover after the database restart"
    fi
    sleep 2
  done
}

payment_settled() {
  local status
  status="$(request "$BASE_URL/api/payments/$PAYMENT_ID")" || return 1
  [ "$status" = "200" ] || return 1
  [ "$(jq -r '.status' "$TMP_DIR/body")" = "completed" ]
}

printf 'Running persistence test against %s\n' "$BASE_URL"

# Create the records that must survive.
status="$(request -X POST "$BASE_URL/api/products" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Persistence Test Widget","description":"Created by scripts/persistence-test.sh","price":49.95,"stockQuantity":5}')" \
  || fail "product create request failed"
[ "$status" = "201" ] || fail "product create returned HTTP $status (expected 201)"
PRODUCT_ID="$(jq -r '.id' "$TMP_DIR/body")"
[ -n "$PRODUCT_ID" ] && [ "$PRODUCT_ID" != "null" ] || fail "created product has no id"
pass "product created ($PRODUCT_ID)"

status="$(request -X POST "$BASE_URL/api/payments" \
  -H 'Content-Type: application/json' \
  -d "{\"amount\":49.95,\"currency\":\"USD\",\"paymentMethod\":\"credit_card\",\"productId\":\"$PRODUCT_ID\",\"customerInfo\":{\"name\":\"Persistence Test\"},\"cardDetails\":{\"number\":\"4111111111111111\",\"expiryMonth\":12,\"expiryYear\":2030,\"cvv\":\"123\"}}")" \
  || fail "payment create request failed"
[ "$status" = "201" ] || fail "payment create returned HTTP $status (expected 201)"
PAYMENT_ID="$(jq -r '.id' "$TMP_DIR/body")"
[ -n "$PAYMENT_ID" ] && [ "$PAYMENT_ID" != "null" ] || fail "created payment has no id"

for _ in $(seq 1 40); do
  payment_settled && break
  sleep 0.5
done
payment_settled || fail "payment did not reach completed in time"
pass "payment completed ($PAYMENT_ID)"

product_snapshot() {
  local status
  status="$(request "$BASE_URL/api/products/$PRODUCT_ID")" || fail "product get failed"
  [ "$status" = "200" ] || fail "product get returned HTTP $status"
  jq -cS '{id,name,price,stockQuantity}' "$TMP_DIR/body"
}

payment_snapshot() {
  local status
  status="$(request "$BASE_URL/api/payments/$PAYMENT_ID")" || fail "payment get failed"
  [ "$status" = "200" ] || fail "payment get returned HTTP $status"
  jq -cS '{id,status,amount,cardDetails}' "$TMP_DIR/body"
}

BASE_PRODUCT="$(product_snapshot)"
BASE_PAYMENT="$(payment_snapshot)"
printf 'Snapshot product: %s\n' "$BASE_PRODUCT"
printf 'Snapshot payment: %s\n' "$BASE_PAYMENT"

assert_unchanged() {
  local label="$1"
  local product payment
  product="$(product_snapshot)"
  payment="$(payment_snapshot)"

  [ "$product" = "$BASE_PRODUCT" ] \
    || fail "$label: product changed (expected $BASE_PRODUCT, got $product)"
  [ "$payment" = "$BASE_PAYMENT" ] \
    || fail "$label: payment changed (expected $BASE_PAYMENT, got $payment)"
  pass "$label kept product and payment unchanged"
}

# Cycle 1: restart every container.
printf '\nCycle 1: docker compose restart\n'
compose restart >/dev/null
wait_for_gateway "docker compose restart"
assert_unchanged "cycle 1 (restart)"

# Cycle 2: stop then start.
printf '\nCycle 2: docker compose stop + start\n'
compose stop >/dev/null
compose start >/dev/null
wait_for_gateway "docker compose stop + start"
assert_unchanged "cycle 2 (stop + start)"

# Cycle 3: down then up (never -v).
printf '\nCycle 3: docker compose down + up -d --wait\n'
compose down >/dev/null
compose up -d --wait >/dev/null
wait_for_gateway "docker compose down + up"
assert_unchanged "cycle 3 (down + up)"

# Cycle 4: restart only the database container.
printf '\nCycle 4: docker compose restart database\n'
compose restart database >/dev/null
wait_for_db_backed_reads
assert_unchanged "cycle 4 (database-only restart)"

# Clean up the product created by this test (payments are retained by design).
status="$(request -X DELETE "$BASE_URL/api/products/$PRODUCT_ID")" || fail "cleanup delete failed"
[ "$status" = "204" ] || fail "cleanup delete returned HTTP $status (expected 204)"

printf '\nAll persistence cycles passed; data survived restart, stop/start, down/up, and a database-only restart.\n'
