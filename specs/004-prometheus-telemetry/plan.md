# Implementation Plan: Prometheus Telemetry

**Branch**: `004-prometheus-telemetry` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-prometheus-telemetry/spec.md`

## Summary

Add Prometheus-based observability to the existing Compose stack. Each service exposes a `/metrics` endpoint in Prometheus text format 0.0.4. A Prometheus container runs in the stack, scrapes all services over the internal network every 15 seconds, and stores samples with a 7-day / 1 GB retention. Metrics cover HTTP golden signals (requests, errors, latency, in-flight), runtime health, database pool health, and bounded business metrics (product count, total stock, payment outcomes). No existing API route, payload, status code, or persistence behavior changes.

## Technical Context

**Language/Version**: TypeScript 5.2 compiled to CommonJS ES2020; Node.js 22 LTS runtime containers (unchanged).
**Primary Dependencies**: Existing Express 4.18, `pg`, `axios`, `cors`, `uuid`; new `prom-client` for metric registration and exposition in each service. Prometheus server via the official `prom/prometheus` image.
**Storage**: No new application storage. Each process keeps an in-memory metric registry; Prometheus stores time series in its own container volume (`prometheus_data`).
**Testing**: No unit-test framework. Validation is script- and health-check-based, consistent with features 001–003 (`curl`/`jq` smoke checks against `/metrics` and the Prometheus API).
**Target Platform**: Linux containers orchestrated by Docker Compose on the existing `ecommerce` network.
**Project Type**: Multi-service web application (api-gateway, product-service, payment-service) plus an observability container.
**Performance Goals**: Added p95 request latency < 5 ms per service (SC-007); scrape interval 15 s.
**Constraints**: No change to existing HTTP API contract; no host port for services except gateway (8080) and Prometheus UI (9090); bounded metric cardinality; no sensitive data in labels; no auth/TLS (consistent with project scope).
**Scale/Scope**: 3 instrumented services + 1 Prometheus container; a small, fixed set of metrics per service.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is an unratified placeholder, so no enforceable gates exist. Consistency with prior features is maintained:

- Separate containers on the private network: Prometheus joins `ecommerce`; only its UI is published on 9090.
- No schema or API changes: telemetry is additive and read-only.
- No credentials logged or baked into images.
- Validation remains script- and health-check-based.

**Gate status**: PASS (placeholder constitution, no violations).

## Project Structure

### Documentation (this feature)

```text
specs/004-prometheus-telemetry/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (metric definitions)
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── metrics-endpoint.md
└── tasks.md             # Phase 2 output (/speckit.tasks - NOT created here)
```

### Source Code (repository root)

```text
api-gateway/
├── src/
│   ├── app.ts
│   ├── metrics.ts        # NEW: registry, middleware, default metrics
│   └── ...
product-service/
├── src/
│   ├── app.ts
│   ├── metrics.ts        # NEW
│   ├── store.ts          # updated: business metric increments
│   └── ...
payment-service/
├── src/
│   ├── app.ts
│   ├── metrics.ts        # NEW
│   ├── store.ts          # updated: payment metric increments
│   └── ...
prometheus/
└── prometheus.yml        # NEW: scrape config + retention hints
docker-compose.yml        # updated: prometheus service + volume
```

**Structure Decision**: Extend the existing multi-service layout. Add a per-service `src/metrics.ts` module owning the `prom-client` registry, the HTTP middleware, and business-metric helpers, so instrumentation stays isolated from route handlers. Add a top-level `prometheus/` directory for the committed scrape configuration. No new service directories.

## Complexity Tracking

No constitution violations; no complexity justification required. (Complexity is additive and confined to one new module per service plus one config file.)