#!/usr/bin/env bash

# Simple manual API test for the containerized e-commerce stack.
#
# Start the stack first:
#   docker compose up -d
#
# Run this file:
#   bash test-api.sh
#
# Optional: point at another host
#   BASE_URL=http://localhost:8080 bash test-api.sh
#
# Requires: curl and jq (used only to pretty-print and capture IDs).

set -u

BASE_URL="${BASE_URL:-http://localhost:8080}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

for cmd in curl jq; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Error: '$cmd' is required." >&2
    exit 1
  }
done

step() {
  printf '\n============================================================\n'
  printf '%s\n' "$1"
  printf '============================================================\n'
}

step "1. Gateway health"
# curl http://localhost:8080/health
curl -sS "$BASE_URL/health" | jq .

step "2. Create a product"
# curl -X POST http://localhost:8080/api/products \
#   -H 'Content-Type: application/json' \
#   -d '{"name":"Test Widget","description":"Manual test","price":19.99,"stockQuantity":5}'
curl -sS -X POST "$BASE_URL/api/products" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Widget","description":"Manual test","price":19.99,"stockQuantity":5}' \
  | tee "$TMP_DIR/product.json" | jq .

PRODUCT_ID="$(jq -r '.id' "$TMP_DIR/product.json")"
echo "Product ID: $PRODUCT_ID"

step "3. List all products"
# curl http://localhost:8080/api/products
curl -sS "$BASE_URL/api/products" | jq .

step "4. Get one product"
# curl http://localhost:8080/api/products/$PRODUCT_ID
curl -sS "$BASE_URL/api/products/$PRODUCT_ID" | jq .

step "5. Update the product price"
# curl -X PUT http://localhost:8080/api/products/$PRODUCT_ID \
#   -H 'Content-Type: application/json' -d '{"price":24.99}'
curl -sS -X PUT "$BASE_URL/api/products/$PRODUCT_ID" \
  -H 'Content-Type: application/json' \
  -d '{"price":24.99}' | jq .

step "6. Create a payment (test card 4111... always succeeds)"
# curl -X POST http://localhost:8080/api/payments \
#   -H 'Content-Type: application/json' \
#   -d '{"amount":24.99,"currency":"USD","paymentMethod":"credit_card","productId":"'$PRODUCT_ID'","customerInfo":{"name":"Test User","email":"test@example.com"},"cardDetails":{"number":"4111111111111111","expiryMonth":12,"expiryYear":2030,"cvv":"123"}}'
curl -sS -X POST "$BASE_URL/api/payments" \
  -H 'Content-Type: application/json' \
  -d "{
    \"amount\": 24.99,
    \"currency\": \"USD\",
    \"paymentMethod\": \"credit_card\",
    \"productId\": \"$PRODUCT_ID\",
    \"customerInfo\": {\"name\": \"Test User\", \"email\": \"test@example.com\"},
    \"cardDetails\": {\"number\": \"4111111111111111\", \"expiryMonth\": 12, \"expiryYear\": 2030, \"cvv\": \"123\"}
  }" | tee "$TMP_DIR/payment.json" | jq .

PAYMENT_ID="$(jq -r '.id' "$TMP_DIR/payment.json")"
echo "Payment ID: $PAYMENT_ID"

step "7. Check payment status (it starts pending, then completes)"
# curl http://localhost:8080/api/payments/$PAYMENT_ID
for attempt in $(seq 1 10); do
  curl -sS "$BASE_URL/api/payments/$PAYMENT_ID" | tee "$TMP_DIR/payment-status.json" | jq .
  STATUS="$(jq -r '.status' "$TMP_DIR/payment-status.json")"
  [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] && break
  sleep 1
done

step "8. Check product stock (5 -> 4 after a completed payment)"
# curl http://localhost:8080/api/products/$PRODUCT_ID
curl -sS "$BASE_URL/api/products/$PRODUCT_ID" | jq .

step "9. Error example: missing product"
# curl -i http://localhost:8080/api/products/does-not-exist
curl -sS -i "$BASE_URL/api/products/does-not-exist" | head -1
curl -sS "$BASE_URL/api/products/does-not-exist" | jq .

step "10. Error example: unknown route"
# curl -i http://localhost:8080/api/unknown
curl -sS -i "$BASE_URL/api/unknown" | head -1
curl -sS "$BASE_URL/api/unknown" | jq .

step "11. Delete the test product"
# curl -i -X DELETE http://localhost:8080/api/products/$PRODUCT_ID
curl -sS -i -X DELETE "$BASE_URL/api/products/$PRODUCT_ID" | head -1

step "Done"
echo "Test product deleted. In-memory data resets when the stack restarts."
