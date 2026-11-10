#!/usr/bin/env bash
#
# Verify that concurrent payments cannot oversell stock.
#
# A product with 10 units is charged 20 times at once with the success test
# card. The script waits for every payment to settle, then asserts:
#   - final stock is 0 (never negative)
#   - exactly 10 payments are completed and 10 are failed
#   - no payment is left pending
#   - every request returned 201 or 422
#
# Each payment either decrements one unit or ends failed; the conditional
# `UPDATE ... WHERE stock_quantity > 0` is the concurrency control.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BASE_URL="${BASE_URL:-http://localhost:8080}"
INITIAL_STOCK=10
CONCURRENCY=20
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
  curl -sS --connect-timeout 3 --max-time 20 -o "$TMP_DIR/body" -w '%{http_code}' "$@"
}

printf 'Running concurrency test against %s\n' "$BASE_URL"

status="$(request -X POST "$BASE_URL/api/products" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Concurrency Test Widget\",\"description\":\"Created by scripts/concurrency-test.sh\",\"price\":5.00,\"stockQuantity\":$INITIAL_STOCK}")" \
  || fail "product create request failed"
[ "$status" = "201" ] || fail "product create returned HTTP $status (expected 201)"
PRODUCT_ID="$(jq -r '.id' "$TMP_DIR/body")"
[ -n "$PRODUCT_ID" ] && [ "$PRODUCT_ID" != "null" ] || fail "created product has no id"
pass "product created with stock $INITIAL_STOCK ($PRODUCT_ID)"

PAYMENT_BODY="$TMP_DIR/payment.json"
cat > "$PAYMENT_BODY" <<JSON
{
  "amount": 5.00,
  "currency": "USD",
  "paymentMethod": "credit_card",
  "productId": "$PRODUCT_ID",
  "customerInfo": {"name": "Concurrency Test"},
  "cardDetails": {"number": "4111111111111111", "expiryMonth": 12, "expiryYear": 2030, "cvv": "123"}
}
JSON

printf 'Firing %s concurrent payment requests...\n' "$CONCURRENCY"
pids=()
for i in $(seq 1 "$CONCURRENCY"); do
  (
    code="$(curl -sS --connect-timeout 3 --max-time 30 \
      -o "$TMP_DIR/payment-$i.json" \
      -w '%{http_code}' \
      -X POST "$BASE_URL/api/payments" \
      -H 'Content-Type: application/json' \
      --data-binary @"$PAYMENT_BODY")"
    printf '%s' "$code" > "$TMP_DIR/payment-$i.code"
  ) &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  wait "$pid"
done

REQUEST_COUNT=0
UNEXPECTED_CODES=""
for i in $(seq 1 "$CONCURRENCY"); do
  code="$(cat "$TMP_DIR/payment-$i.code")"
  REQUEST_COUNT=$((REQUEST_COUNT + 1))
  case "$code" in
    201|422) ;;
    *) UNEXPECTED_CODES="$UNEXPECTED_CODES $code" ;;
  esac
done
[ -z "$UNEXPECTED_CODES" ] \
  || fail "unexpected payment response status codes:$UNEXPECTED_CODES (only 201 and 422 are allowed)"
pass "all $REQUEST_COUNT requests returned 201 or 422"

payment_settled() {
  local status
  status="$(request "$BASE_URL/api/payments")" || return 1
  [ "$status" = "200" ] || return 1
  jq -e --arg pid "$PRODUCT_ID" 'all(.[] | select(.productId == $pid); .status != "pending")' \
    "$TMP_DIR/body" >/dev/null
}

for _ in $(seq 1 60); do
  payment_settled && break
  sleep 0.5
done
payment_settled || fail "not all payments settled in time"

COMPLETED="$(jq --arg pid "$PRODUCT_ID" \
  '[.[] | select(.productId == $pid and .status == "completed")] | length' "$TMP_DIR/body")"
FAILED="$(jq --arg pid "$PRODUCT_ID" \
  '[.[] | select(.productId == $pid and .status == "failed")] | length' "$TMP_DIR/body")"
PENDING="$(jq --arg pid "$PRODUCT_ID" \
  '[.[] | select(.productId == $pid and .status == "pending")] | length' "$TMP_DIR/body")"
TOTAL="$(jq --arg pid "$PRODUCT_ID" \
  '[.[] | select(.productId == $pid)] | length' "$TMP_DIR/body")"

status="$(request "$BASE_URL/api/products/$PRODUCT_ID")" || fail "product get request failed"
[ "$status" = "200" ] || fail "product get returned HTTP $status"
FINAL_STOCK="$(jq -r '.stockQuantity' "$TMP_DIR/body")"

printf 'Results: completed=%s failed=%s pending=%s total=%s final_stock=%s\n' \
  "$COMPLETED" "$FAILED" "$PENDING" "$TOTAL" "$FINAL_STOCK"

[ "$PENDING" = "0" ] || fail "payments are still pending after the timeout"
[ "$TOTAL" = "$CONCURRENCY" ] || fail "expected $CONCURRENCY persisted payments, found $TOTAL"
[ "$COMPLETED" = "$INITIAL_STOCK" ] \
  || fail "expected exactly $INITIAL_STOCK completed payments, found $COMPLETED"
[ "$FAILED" = "$((CONCURRENCY - INITIAL_STOCK))" ] \
  || fail "expected $((CONCURRENCY - INITIAL_STOCK)) failed payments, found $FAILED"
[ "$FINAL_STOCK" = "0" ] || fail "expected final stock 0, found $FINAL_STOCK (overselling or lost decrement)"
[ "$((INITIAL_STOCK - COMPLETED))" = "$FINAL_STOCK" ] \
  || fail "completed payments ($COMPLETED) contradict final stock ($FINAL_STOCK)"

pass "no overselling: stock $INITIAL_STOCK -> $FINAL_STOCK with exactly $COMPLETED completed payments"

# Clean up the product created by this test (payments are retained by design).
status="$(request -X DELETE "$BASE_URL/api/products/$PRODUCT_ID")" || fail "cleanup delete failed"
[ "$status" = "204" ] || fail "cleanup delete returned HTTP $status (expected 204)"

printf '\nConcurrency test passed.\n'
