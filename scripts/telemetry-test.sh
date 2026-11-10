#!/usr/bin/env bash
#
# Verify Prometheus telemetry end to end.
#
# Checks (incrementally extended by later tasks):
#   - Prometheus is healthy on the host (port 9090)
#   - All three scrape targets report up
#   - Every service exposes a non-empty /metrics document with HELP/TYPE lines
#   - HTTP golden signals are queryable (added in US2)
#   - Business metrics reflect API state (added in US3)
#   - Prometheus recovers after a container restart (added in US4)
#   - No sensitive data or unbounded cardinality (polish)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BASE_URL="${BASE_URL:-http://localhost:8080}"
PROM_URL="${PROM_URL:-http://localhost:9090}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is required to run this script"
}

require curl
require jq

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

printf 'Running telemetry test against %s (Prometheus %s)\n' "$BASE_URL" "$PROM_URL"

# 1. Prometheus health
status="$(request "$PROM_URL/-/healthy")" || fail "Prometheus is unreachable at $PROM_URL"
[ "$status" = "200" ] || fail "Prometheus health returned HTTP $status"
grep -q 'Healthy' "$TMP_DIR/body" || fail "Prometheus health body is unexpected"
pass "Prometheus is healthy"

# 2. All scrape targets up
status="$(request "$PROM_URL/api/v1/targets")" || fail "Prometheus targets endpoint unreachable"
[ "$status" = "200" ] || fail "Prometheus targets returned HTTP $status"
TARGETS_TOTAL="$(jq '.data.activeTargets | length' "$TMP_DIR/body")"
[ "$TARGETS_TOTAL" -eq 3 ] || fail "expected 3 scrape targets, found $TARGETS_TOTAL"

# Wait for the first scrape cycle to complete.
for _ in $(seq 1 45); do
  status="$(request "$PROM_URL/api/v1/targets")" || fail "Prometheus targets endpoint unreachable"
  TARGETS_UP="$(jq '[.data.activeTargets[] | select(.health == "up")] | length' "$TMP_DIR/body")"
  [ "$TARGETS_UP" -eq 3 ] && break
  sleep 2
done
[ "$TARGETS_UP" -eq 3 ] || fail "expected 3 targets up, found $TARGETS_UP"
pass "all $TARGETS_TOTAL scrape targets are up"

# 3. Every service exposes /metrics with HELP/TYPE lines
for svc in api-gateway product-service payment-service; do
  port=""
  case "$svc" in
    api-gateway) port=8080 ;;
    product-service) port=3001 ;;
    payment-service) port=3002 ;;
  esac

  if [ "$svc" = "api-gateway" ]; then
    code="$(request "$BASE_URL/metrics")" || fail "$svc /metrics unreachable"
    [ "$code" = "200" ] || fail "$svc /metrics returned HTTP $code"
  else
    compose exec -T "$svc" wget -qO- "http://localhost:${port}/metrics" > "$TMP_DIR/metrics-$svc.txt" 2>/dev/null \
      || fail "could not fetch $svc /metrics"
    code=200
  fi

  if [ "$svc" = "api-gateway" ]; then
    cp "$TMP_DIR/body" "$TMP_DIR/metrics-$svc.txt"
  fi

  grep -q '^# HELP' "$TMP_DIR/metrics-$svc.txt" || fail "$svc /metrics has no HELP lines"
  grep -q '^# TYPE' "$TMP_DIR/metrics-$svc.txt" || fail "$svc /metrics has no TYPE lines"
  [ -s "$TMP_DIR/metrics-$svc.txt" ] || fail "$svc /metrics is empty"
  pass "$svc exposes a valid /metrics document"
done

# --- US2: HTTP golden signals ---
# Generate a mix of successful and failing requests.
for _ in $(seq 1 5); do
  curl -sS -o /dev/null "$BASE_URL/health" || true
  curl -sS -o /dev/null "$BASE_URL/api/products/does-not-exist" || true
done
curl -sS -o /dev/null -X POST "$BASE_URL/api/products" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Telemetry Widget","description":"telemetry","price":1.00,"stockQuantity":3}' || true

# Wait for at least one scrape cycle after the traffic.
sleep 20

status="$(request "$PROM_URL/api/v1/query?query=http_requests_total")" || fail "Prometheus query unreachable"
[ "$status" = "200" ] || fail "http_requests_total query returned HTTP $status"
[ "$(jq '.data.result | length' "$TMP_DIR/body")" -gt 0 ] || fail "http_requests_total has no series"
pass "http_requests_total is populated"

status="$(request "$PROM_URL/api/v1/query?query=http_errors_total")" || fail "Prometheus query unreachable"
[ "$(jq '.data.result | length' "$TMP_DIR/body")" -gt 0 ] || fail "http_errors_total has no series"
pass "http_errors_total is populated"

status="$(request "$PROM_URL/api/v1/query?query=histogram_quantile(0.95,sum(http_request_duration_seconds_bucket)by(le))")" || fail "latency query unreachable"
LATENCY="$(jq -r '.data.result[0].value[1] // empty' "$TMP_DIR/body")"
[ -n "$LATENCY" ] && [ "$LATENCY" != "null" ] && [ "$LATENCY" != "NaN" ] || fail "p95 latency is not a finite number (got: $LATENCY)"
pass "p95 latency is queryable ($LATENCY)"

# --- US3: business metrics ---
PRODUCT_ID="$(curl -sS -X POST "$BASE_URL/api/products" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Business Metric Widget","description":"telemetry","price":2.00,"stockQuantity":5}' | jq -r .id)"
[ -n "$PRODUCT_ID" ] && [ "$PRODUCT_ID" != "null" ] || fail "could not create telemetry test product"

PAYMENT_BODY="$TMP_DIR/payment.json"
cat > "$PAYMENT_BODY" <<JSON
{
  "amount": 2.00,
  "currency": "USD",
  "paymentMethod": "credit_card",
  "productId": "$PRODUCT_ID",
  "cardDetails": {"number": "4111111111111111", "expiryMonth": 12, "expiryYear": 2030, "cvv": "123"}
}
JSON
curl -sS -o /dev/null -X POST "$BASE_URL/api/payments" \
  -H 'Content-Type: application/json' \
  --data-binary @"$PAYMENT_BODY" || true

# Wait for payment completion and a scrape.
for _ in $(seq 1 20); do
  sleep 1
  PS="$(curl -sS "$BASE_URL/api/payments" | jq --arg pid "$PRODUCT_ID" '[.[] | select(.productId == $pid)] | all(.status != "pending")')" 
  [ "$PS" = "true" ] && break
done

sleep 20

status="$(request "$PROM_URL/api/v1/query?query=products_total")" || fail "products_total query unreachable"
[ "$(jq '.data.result | length' "$TMP_DIR/body")" -gt 0 ] || fail "products_total has no series"
pass "products_total is populated"

status="$(request "$PROM_URL/api/v1/query?query=payments_completed_total")" || fail "payments_completed_total query unreachable"
[ "$(jq '.data.result | length' "$TMP_DIR/body")" -gt 0 ] || fail "payments_completed_total has no series"
pass "payments_completed_total is populated"

status="$(request "$PROM_URL/api/v1/query?query=stock_total")" || fail "stock_total query unreachable"
[ "$(jq '.data.result | length' "$TMP_DIR/body")" -gt 0 ] || fail "stock_total has no series"
pass "stock_total is populated"

# Cleanup the product created by this test (payments are retained).
curl -sS -o /dev/null -X DELETE "$BASE_URL/api/products/$PRODUCT_ID" || true

# --- US4: Prometheus recovers after a container restart ---
compose restart prometheus >/dev/null
for _ in $(seq 1 30); do
  if curl -fsS --connect-timeout 2 --max-time 3 "$PROM_URL/-/healthy" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS --connect-timeout 2 --max-time 3 "$PROM_URL/-/healthy" >/dev/null 2>&1 || fail "Prometheus did not recover after restart"
pass "Prometheus recovers after a container restart"

# --- Polish: no sensitive data in metric documents ---
for svc in api-gateway product-service payment-service; do
  if [ "$svc" = "api-gateway" ]; then
    if grep -Eiq 'card|cvv|password|token|secret' "$TMP_DIR/metrics-$svc.txt"; then
      fail "sensitive data found in $svc metrics"
    fi
  else
    compose exec -T "$svc" wget -qO- "http://localhost:$(case $svc in product-service) echo 3001;; payment-service) echo 3002;; esac)/metrics" 2>/dev/null > "$TMP_DIR/metrics-$svc.txt" || true
    if grep -Eiq 'card|cvv|password|token|secret' "$TMP_DIR/metrics-$svc.txt"; then
      fail "sensitive data found in $svc metrics"
    fi
  fi
  pass "no sensitive data in $svc metrics"
done

printf '\nTelemetry checks passed.\n'