# Research: Prometheus Telemetry

**Feature**: `004-prometheus-telemetry`
**Date**: 2026-11-10

## Decisions

### R1. Metrics library

- **Decision**: Use `prom-client` in each Node.js service.
- **Rationale**: It is the de facto Prometheus client for Node.js, outputs text format 0.0.4 directly, supports default process/runtime metrics, histograms, counters, and gauges, and integrates cleanly with Express via a middleware pattern.
- **Alternatives considered**: OpenTelemetry SDK (vendor-neutral but heavier, requires an exporter/collector and adds indirection not needed for a Prometheus-only target); hand-rolled text serialization (error-prone, reinvents maintained code).

### R2. HTTP instrumentation approach

- **Decision**: A small custom Express middleware in each service's `metrics.ts` that records request count, status class, and duration, plus a `/metrics` route returning `registry.metrics()`.
- **Rationale**: Full control over label cardinality (method, route template, status class) and metric names; avoids auto-generated high-cardinality labels (for example raw URLs or IDs).
- **Alternatives considered**: `express-prom-bundle` (convenient but generates route labels from path params, risking cardinality blow-up and requiring extra configuration to disable).

### R3. Route label strategy

- **Decision**: Use the Express route pattern (e.g. `/products/:id`) as the `route` label, never the concrete path. Unknown routes are bucketed under a single `route="unmatched"` label.
- **Rationale**: Keeps cardinality bounded regardless of traffic or number of distinct IDs.
- **Alternatives considered**: Raw request path (rejected — unbounded cardinality).

### R4. Status label strategy

- **Decision**: Record the numeric HTTP status code as a label value, grouped into the standard classes only where a coarser view is needed; the primary counter uses the exact status code.
- **Rationale**: Exact codes are needed for debugging and still bounded (a finite set of HTTP statuses). No per-request identifiers are included.
- **Alternatives considered**: Status class only (loses useful detail).

### R5. Business metrics

- **Decision**: Increment counters/gauges inside the existing store and controller paths: products created/deleted, total stock, payments created/completed/failed, pending payments gauge.
- **Rationale**: Metrics reflect durable state transitions at the point they occur; reusing existing code paths avoids duplicate logic.
- **Alternatives considered**: Periodic polling of the database (adds load and lag; rejected).

### R6. Per-product stock cardinality

- **Decision**: Report total stock as a single gauge plus product count; do not emit per-product stock series. Per-product stock remains available via the product API.
- **Rationale**: Resolves the tension between FR-006 and FR-008; prevents unbounded series growth.
- **Alternatives considered**: Per-product series with product id label (rejected — violates cardinality constraint).

### R7. Prometheus deployment

- **Decision**: Add a `prometheus` service using `prom/prometheus` with a bind-mounted `prometheus/prometheus.yml`, a named volume `prometheus_data`, retention `7d` / 1 GB, and a published UI on port 9090.
- **Rationale**: Committed config keeps scrape targets reproducible; retention bounds disk; publishing 9090 matches the clarification and lets operators use the UI without extra steps.
- **Alternatives considered**: Internal-only Prometheus (rejected — poor operator UX); Grafana (out of scope).

### R8. Scrape configuration

- **Decision**: Scrape `api-gateway:8080`, `product-service:3001`, and `payment-service:3002` at `/metrics` every 15 seconds.
- **Rationale**: Reuses existing service DNS and ports; 15 s is a standard default balancing freshness and overhead.
- **Alternatives considered**: 5 s interval (rejected — unnecessary overhead for local dev).

### R9. Default runtime metrics

- **Decision**: Enable `prom-client`'s default metrics (process CPU, memory, event loop, GC) on each service.
- **Rationale**: Free, standard runtime health signal with no custom code.
- **Alternatives considered**: None.

### R10. Database pool metrics

- **Decision**: Expose pool size/idle/waiting counts as gauges updated on each `/metrics` scrape (or on pool events).
- **Rationale**: Helps diagnose connection exhaustion without leaking credentials.
- **Alternatives considered**: None.

## Open Questions

None. All clarification items from the spec session are resolved.