#!/usr/bin/env bash

set -euo pipefail

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

request() {
  curl -sS --connect-timeout 3 --max-time 15 -o "$TMP_DIR/body" -w '%{http_code}' "$@"
}

printf 'Verifying host isolation and internal service discovery\n'

# 1. Gateway must be reachable from the host.
status="$(request "$BASE_URL/health")" || fail "gateway is unreachable at $BASE_URL"
[ "$status" = "200" ] || fail "gateway health returned HTTP $status"
pass "gateway reachable on host"

# 2. Backend ports must NOT be reachable from the host.
for port in 3001 3002; do
  if curl -sS --connect-timeout 2 --max-time 3 "http://localhost:${port}/health" >/dev/null 2>&1; then
    fail "backend port ${port} is reachable from the host; it must stay internal"
  fi
  pass "host access to port ${port} refused"
done

# 3. A payment through the gateway proves the internal DNS path works.
status="$(request -X POST "$BASE_URL/api/products" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Isolation Test Widget","description":"Created by scripts/verify-isolation.sh","price":9.99,"stockQuantity":2}')" \
  || fail "product create request failed"
[ "$status" = "201" ] || fail "product create returned HTTP $status"
PRODUCT_ID="$(jq -r '.id' "$TMP_DIR/body")"
[ -n "$PRODUCT_ID" ] && [ "$PRODUCT_ID" != "null" ] || fail "created product has no id"

status="$(request -X POST "$BASE_URL/api/payments" \
  -H 'Content-Type: application/json' \
  -d "{\"amount\":9.99,\"currency\":\"USD\",\"paymentMethod\":\"credit_card\",\"productId\":\"$PRODUCT_ID\",\"customerInfo\":{\"name\":\"Isolation Test\"},\"cardDetails\":{\"number\":\"4111111111111111\",\"expiryMonth\":12,\"expiryYear\":2030,\"cvv\":\"123\"}}")" \
  || fail "payment create request failed"
[ "$status" = "201" ] || fail "payment create returned HTTP $status"
PAYMENT_ID="$(jq -r '.id' "$TMP_DIR/body")"
[ -n "$PAYMENT_ID" ] && [ "$PAYMENT_ID" != "null" ] || fail "created payment has no id"

PAYMENT_STATUS=""
for _ in $(seq 1 20); do
  status="$(request "$BASE_URL/api/payments/$PAYMENT_ID")" || fail "payment get request failed"
  [ "$status" = "200" ] || fail "payment get returned HTTP $status"
  PAYMENT_STATUS="$(jq -r '.status' "$TMP_DIR/body")"
  [ "$PAYMENT_STATUS" = "completed" ] && break
  [ "$PAYMENT_STATUS" = "failed" ] && fail "payment failed; internal product lookup is not working"
  sleep 0.5
done
[ "$PAYMENT_STATUS" = "completed" ] || fail "payment did not complete; internal DNS path may be broken"
pass "payment reached product service over the internal network"

status="$(request "$BASE_URL/api/products/$PRODUCT_ID")" || fail "product get request failed"
[ "$status" = "200" ] || fail "product get returned HTTP $status"
jq -e '.stockQuantity == 1' "$TMP_DIR/body" >/dev/null || fail "stock was not decremented across services"

status="$(request -X DELETE "$BASE_URL/api/products/$PRODUCT_ID")" || fail "cleanup delete failed"
[ "$status" = "204" ] || fail "cleanup delete returned HTTP $status"

printf '\nIsolation and internal discovery checks passed.\n'
