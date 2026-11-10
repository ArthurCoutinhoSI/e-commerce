# Data Model: Prometheus Telemetry

**Feature**: `004-prometheus-telemetry`
**Date**: 2026-11-10

This feature adds no database tables. It defines the metric catalog exposed by each service and scraped by Prometheus. Metric names follow Prometheus naming conventions: lowercase, underscores, `_total` suffix for counters, `_seconds` for durations, `_bytes` for sizes.

## Common labels

Every HTTP metric carries these bounded labels:

| Label | Values | Notes |
|-------|--------|-------|
| `service` | `api-gateway`, `product-service`, `payment-service` | Identifies the emitting service |
| `method` | HTTP method (e.g. `GET`, `POST`) | |
| `route` | Route template (e.g. `/products/:id`) or `unmatched` | Never a concrete path or ID |
| `status_code` | Numeric HTTP status (e.g. `200`, `404`) | Finite set |

No identifier (product ID, payment ID, user ID, card data) may appear in any label value.

## Metric catalog

### All services

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | service, method, route, status_code | Total HTTP requests handled |
| `http_request_duration_seconds` | Histogram | service, method, route | Request latency distribution |
| `http_requests_in_flight` | Gauge | service | Requests currently being processed |
| `http_errors_total` | Counter | service, method, route, status_code | Requests ending in 4xx/5xx (derived or separate counter) |

Plus `prom-client` default metrics (process CPU, memory, event loop, GC) with the standard `process_*` / `nodejs_*` names.

### API gateway (additional)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `gateway_upstream_requests_total` | Counter | service, upstream, status_code | Requests forwarded to a backend |
| `gateway_upstream_duration_seconds` | Histogram | service, upstream | Backend call latency |

### Product service (additional)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `products_total` | Gauge | service | Current number of products |
| `products_created_total` | Counter | service | Products created |
| `products_deleted_total` | Counter | service | Products deleted |
| `stock_total` | Gauge | service | Total stock across all products |
| `db_pool_size` | Gauge | service | Total DB pool connections |
| `db_pool_idle` | Gauge | service | Idle DB pool connections |
| `db_pool_waiting` | Gauge | service | Clients waiting for a connection |

### Payment service (additional)

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `payments_created_total` | Counter | service | Payments created |
| `payments_completed_total` | Counter | service | Payments reaching `completed` |
| `payments_failed_total` | Counter | service, reason | Payments reaching `failed` (reason is a bounded enum: `card_declined`, `insufficient_stock`, `processing_failed`, `stock_reservation_failed`) |
| `payments_pending` | Gauge | service | Payments currently `pending` |
| `stock_decrements_total` | Counter | service, result | Decrement attempts (`success` / `insufficient`) |
| `stock_compensations_total` | Counter | service | Compensating increments performed |
| `db_pool_size` / `db_pool_idle` / `db_pool_waiting` | Gauge | service | DB pool health |

## Cardinality rules

- Route labels use templates, never concrete IDs.
- Payment failure reasons are a fixed enum; free-text error messages are never used as labels.
- No metric may carry product, payment, order, or user identifiers.
- Default metrics are unmodified.

## Relationships

Metrics are not persisted in the application databases. They live in process memory and are scraped by Prometheus into the `prometheus_data` volume. No foreign keys or cross-service metric joins exist.