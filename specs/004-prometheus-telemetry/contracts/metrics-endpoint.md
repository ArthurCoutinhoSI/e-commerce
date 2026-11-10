# Contract: Metrics Endpoint

**Feature**: `004-prometheus-telemetry`
**Type**: HTTP interface (scraped by Prometheus)

## Endpoint

| Property | Value |
|----------|-------|
| Path | `/metrics` |
| Method | `GET` |
| Content-Type | `text/plain; version=0.0.4; charset=utf-8` |
| Auth | None (internal network; Prometheus scrapes over `ecommerce` network) |
| Side effects | None — read-only |

## Request

No parameters. No request body.

## Response

- `200 OK` with the current metric values in Prometheus text exposition format 0.0.4.
- Each line is a metric sample, help text, or type declaration per the format.
- The response MUST NOT contain sensitive data (card numbers, customer info, credentials, request bodies).

## Failure behavior

- If the registry cannot be serialized, return `500` with the standard error shape `{ "error": "...", "message": "..." }`. This does not affect request handling.
- A scrape timeout or connection failure is recorded by Prometheus as `up=0`; the service is not required to return anything in that case.

## Metric naming

- All names use snake_case and follow Prometheus conventions (`_total`, `_seconds`, `_bytes`).
- Every custom metric includes a `service` label.
- Label values are bounded enums or templates; no identifiers.

## Scrape contract (Prometheus side)

- Targets: `api-gateway:8080`, `product-service:3001`, `payment-service:3002` (all on `/metrics`).
- Interval: 15 seconds.
- Timeout: 10 seconds.
- Metrics path: `/metrics`.