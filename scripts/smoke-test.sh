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

assert_status() {
  local expected="$1"
  local actual="$2"
  local context="$3"
  [ "$actual" = "$expected" ] || fail "$context (expected HTTP $expected, got $actual)"
}

assert_json() {
  local filter="$1"
  local context="$2"
  jq -e "$filter" "$TMP_DIR/body" >/dev/null || fail "$context"
}

printf 'Running gateway smoke test against %s\n' "$BASE_URL"

# 1. Gateway health
status="$(request "$BASE_URL/health")" || fail "gateway is unreachable at $BASE_URL"
assert_status 200 "$status" "gateway health"
assert_json '.status == "ok" and .service == "api-gateway"' "gateway health payload is invalid"
pass "gateway health"

# 2. Create product
status="$(request -X POST "$BASE_URL/api/products" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Test Widget","description":"Created by scripts/smoke-test.sh","price":19.99,"stockQuantity":5}')" \
  || fail "product create request failed"
assert_status 201 "$status" "product create"
assert_json '.id and .name == "Smoke Test Widget" and .price == 19.99 and .stockQuantity == 5 and .createdAt and .updatedAt' \
  "created product payload is invalid"

PRODUCT_ID="$(jq -r '.id' "$TMP_DIR/body")"
[ -n "$PRODUCT_ID" ] && [ "$PRODUCT_ID" != "null" ] || fail "created product has no id"
pass "product create ($PRODUCT_ID)"

# 3. List products
status="$(request "$BASE_URL/api/products")" || fail "product list request failed"
assert_status 200 "$status" "product list"
jq -e --arg id "$PRODUCT_ID" 'any(.[]; .id == $id)' "$TMP_DIR/body" >/dev/null \
  || fail "created product is missing from the list"
pass "product list"

# 4. Get product by id
status="$(request "$BASE_URL/api/products/$PRODUCT_ID")" || fail "product get request failed"
assert_status 200 "$status" "product get"
assert_json '.id and .name == "Smoke Test Widget"' "product get payload is invalid"
pass "product get"

# 5. Update product
status="$(request -X PUT "$BASE_URL/api/products/$PRODUCT_ID" \
  -H 'Content-Type: application/json' \
  -d '{"price":24.99}')" || fail "product update request failed"
assert_status 200 "$status" "product update"
assert_json '.price == 24.99' "product update did not persist the new price"
pass "product update"

# 6. Create payment (success test card)
PAYMENT_BODY="$TMP_DIR/payment.json"
cat > "$PAYMENT_BODY" <<JSON
{
  "amount": 24.99,
  "currency": "USD",
  "paymentMethod": "credit_card",
  "productId": "$PRODUCT_ID",
  "customerInfo": {"name": "Smoke Test", "email": "smoke@example.com"},
  "cardDetails": {"number": "4111111111111111", "expiryMonth": 12, "expiryYear": 2030, "cvv": "123"}
}
JSON

status="$(request -X POST "$BASE_URL/api/payments" \
  -H 'Content-Type: application/json' \
  --data-binary @"$PAYMENT_BODY")" || fail "payment create request failed"
assert_status 201 "$status" "payment create"
assert_json '.id and (.status == "pending" or .status == "completed")' "created payment payload is invalid"

PAYMENT_ID="$(jq -r '.id' "$TMP_DIR/body")"
[ -n "$PAYMENT_ID" ] && [ "$PAYMENT_ID" != "null" ] || fail "created payment has no id"
pass "payment create ($PAYMENT_ID)"

# 7. Poll payment until it is completed
PAYMENT_STATUS=""
for _ in $(seq 1 20); do
  status="$(request "$BASE_URL/api/payments/$PAYMENT_ID")" || fail "payment get request failed"
  assert_status 200 "$status" "payment get"
  PAYMENT_STATUS="$(jq -r '.status' "$TMP_DIR/body")"
  [ "$PAYMENT_STATUS" = "completed" ] && break
  [ "$PAYMENT_STATUS" = "failed" ] && fail "payment failed unexpectedly"
  sleep 0.5
done
[ "$PAYMENT_STATUS" = "completed" ] || fail "payment did not complete in time (last status: $PAYMENT_STATUS)"
pass "payment completed"

# 8. Verify stock decrement through the internal payment -> product call
status="$(request "$BASE_URL/api/products/$PRODUCT_ID")" || fail "post-payment product get failed"
assert_status 200 "$status" "post-payment product get"
assert_json '.stockQuantity == 4' "stock was not decremented after payment (expected 4)"
pass "stock decremented after payment"

# 9. Error shape: unknown route
status="$(request "$BASE_URL/api/unknown")" || fail "unknown route request failed"
assert_status 404 "$status" "unknown route"
assert_json '.error == "Not Found"' "unknown route error payload is invalid"
pass "unknown route returns 404"

# 10. Error shape: missing product
status="$(request "$BASE_URL/api/products/does-not-exist")" || fail "missing product request failed"
assert_status 404 "$status" "missing product"
assert_json '.error == "Not Found" and .message == "Product not found"' "missing product error payload is invalid"
pass "missing product returns 404"

# 11. Clean up
status="$(request -X DELETE "$BASE_URL/api/products/$PRODUCT_ID")" || fail "product delete request failed"
assert_status 204 "$status" "product delete"
pass "product delete"

printf '\nAll smoke tests passed.\n'
