# Quickstart: Prometheus Telemetry Validation

**Feature**: `004-prometheus-telemetry`

## Prerequisites

- Docker Engine 24+ with Compose v2+
- `curl` (for direct endpoint checks)
- Stack running: `docker compose up -d --wait`

## 1. Confirm metrics endpoints

```bash
curl -sS http://localhost:8080/metrics | head
curl -sS http://localhost:3001/metrics 2>/dev/null | head || echo "internal only (expected from host for 3001)"
```

Note: backend `/metrics` endpoints are not published to the host; scrape them via Prometheus or `docker compose exec`.

## 2. Confirm Prometheus is running and healthy

```bash
curl -sS http://localhost:9090/-/healthy
docker compose ps prometheus
```

Expected: `Prometheus Server is Healthy.` and the `prometheus` container is healthy.

## 3. Confirm all targets are up

Open `http://localhost:9090/targets` or query:

```bash
curl -sS 'http://localhost:9090/api/v1/targets' | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'
```

Expected: three targets (`api-gateway`, `product-service`, `payment-service`), all `health: "up"`.

## 4. Confirm HTTP golden signals

Generate traffic:

```bash
bash scripts/smoke-test.sh >/dev/null 2>&1 || true
```

Then query:

```bash
curl -sS 'http://localhost:9090/api/v1/query?query=http_requests_total' | jq '.data.result | length'
curl -sS 'http://localhost:9090/api/v1/query?query=histogram_quantile(0.95,sum(rate(http_request_duration_seconds_bucket[5m]))by(le))' | jq .
```

Expected: non-empty results and a finite p95 value.

## 5. Confirm business metrics

```bash
curl -sS 'http://localhost:9090/api/v1/query?query=products_total' | jq .
curl -sS 'http://localhost:9090/api/v1/query?query=payments_completed_total' | jq .
curl -sS 'http://localhost:9090/api/v1/query?query=stock_total' | jq .
```

Expected: values matching the API state (for example products created by smoke tests).

## 6. Confirm no sensitive data

```bash
for t in api-gateway product-service payment-service; do
  docker compose exec -T "$t" wget -qO- http://localhost:${t##*-}/metrics 2>/dev/null | grep -Ei 'card|cvv|password|token' && echo "LEAK in $t" || echo "OK: no sensitive labels in $t"
done
```

Expected: `OK` for all services (the grep finds nothing).

## 7. Confirm cardinality is bounded

```bash
curl -sS 'http://localhost:9090/api/v1/label/__name__/values' | jq '.data | length'
```

Expected: a small, stable number of metric names; no per-id series.

## 8. Confirm retention

```bash
docker compose exec -T prometheus prometheus --version >/dev/null 2>&1 || true
docker compose logs prometheus | grep -i 'retention\|tsdb' | tail -5
```

Expected: retention configured to 7 days / 1 GB.

## 9. Confirm isolation

```bash
bash scripts/verify-isolation.sh
```

Expected: host access to `:3001`, `:3002`, and `:5432` remains refused. Port `9090` is intentionally published for the Prometheus UI.

## 10. Regression checks

```bash
bash scripts/smoke-test.sh
bash scripts/persistence-test.sh
bash scripts/concurrency-test.sh
```

Expected: all pass unchanged.

## Success Checklist

| Check | Expected |
|-------|----------|
| Prometheus targets | 3/3 `up` |
| `/metrics` endpoints | Valid text format 0.0.4 |
| HTTP golden signals | Queryable per service |
| Business metrics | Match API state |
| No sensitive labels | Confirmed |
| Cardinality | Bounded and stable |
| Retention | 7 days / 1 GB |
| Existing checks | smoke + persistence + concurrency pass |
