# Tasks: Prometheus Telemetry

**Input**: Design documents from `/specs/004-prometheus-telemetry/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/metrics-endpoint.md, quickstart.md

**Tests**: No unit-test framework is introduced. The shell scripts below are required validation deliverables from the plan and quickstart.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently. `scripts/smoke-test.sh` is reused unchanged.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps to the user story in spec.md (`US1`–`US4`)
- Every task includes exact repository-relative file paths

## Path Conventions

- `api-gateway/src/`, `product-service/src/`, `payment-service/src/`
- `prometheus/`
- `docker-compose.yml`, `scripts/`
- `specs/004-prometheus-telemetry/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the Prometheus client dependency and the committed scrape configuration.

- [X] T001 [P] Add `prom-client` to `dependencies` in `api-gateway/package.json`, then run `npm install` in `api-gateway/` to regenerate `api-gateway/package-lock.json`.
- [X] T002 [P] Add `prom-client` to `dependencies` in `product-service/package.json`, then run `npm install` in `product-service/` to regenerate `product-service/package-lock.json`.
- [X] T003 [P] Add `prom-client` to `dependencies` in `payment-service/package.json`, then run `npm install` in `payment-service/` to regenerate `payment-service/package-lock.json`.
- [X] T004 [P] Create `prometheus/prometheus.yml` with a 15 s scrape interval, a 10 s scrape timeout, and targets `api-gateway:8080`, `product-service:3001`, and `payment-service:3002` on `/metrics`, using service DNS names from the `ecommerce` network.
- [X] T005 Document the telemetry configuration in `.env.example`: add `PROMETHEUS_PORT=9090` with a comment that only the Prometheus UI is published and that scrape targets stay internal.

**Checkpoint**: Dependencies install locally and the scrape configuration is committed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Stand up the Prometheus container and give every service a metric registry and `/metrics` endpoint before any story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 [P] Create `api-gateway/src/metrics.ts`: a `prom-client` `Registry`, default process/runtime metrics, a `collectDefaultMetrics()` call, and an exported `metricsHandler` that serializes the registry with the `text/plain; version=0.0.4` content type.
- [X] T007 [P] Create `product-service/src/metrics.ts` with the same registry/default-metrics/handler contract.
- [X] T008 [P] Create `payment-service/src/metrics.ts` with the same registry/default-metrics/handler contract.
- [X] T009 Refactor `api-gateway/src/app.ts` to register `GET /metrics` using `metricsHandler` before the 404 handler; keep health, routes, signals, and shutdown behavior unchanged.
- [X] T010 Refactor `product-service/src/app.ts` to register `GET /metrics` using `metricsHandler` before the 404 handler; keep health, routes, signals, and shutdown behavior unchanged.
- [X] T011 Refactor `payment-service/src/app.ts` to register `GET /metrics` using `metricsHandler` before the 404 handler; keep health, routes, signals, and shutdown behavior unchanged.
- [X] T012 Add the `prometheus` service to `docker-compose.yml`: image `prom/prometheus`, mount `./prometheus/prometheus.yml` read-only, mount `prometheus_data:/prometheus`, publish `9090:9090`, join the `ecommerce` network, `depends_on: api-gateway: condition: service_healthy`, pass `--config.file=/etc/prometheus/prometheus.yml --storage.tsdb.retention.time=7d --storage.tsdb.retention.size=1GB`, add a health check on `/-/healthy`, and declare the `prometheus_data` volume. Do not publish any backend or database port.

**Checkpoint**: `docker compose up --build -d --wait` brings up five healthy containers; `curl http://localhost:9090/-/healthy` succeeds; each service answers `/metrics` internally.

---

## Phase 3: User Story 1 — Scrape Metrics From Every Service (Priority: P1) 🎯 MVP

**Goal**: Prometheus scrapes all three services and reports every target as `up` with non-empty metric documents.

**Independent Test**: Start the stack, open Prometheus targets, and confirm all three targets report `up=1` and each service's `/metrics` returns valid Prometheus text format.

### Implementation for User Story 1

- [X] T013 [US1] Create `scripts/telemetry-test.sh`: require `curl` and `jq`; verify `http://localhost:9090/-/healthy` returns healthy; verify all three Prometheus targets report `health: "up"`; verify each service's `/metrics` (via `docker compose exec`) returns a non-empty body containing `# HELP` and `# TYPE` lines; exit non-zero on the first failure.
- [X] T014 [US1] Run `bash scripts/telemetry-test.sh` against the running stack and fix scrape configuration, service DNS, or metric handler registration until all targets are `up`.

**Checkpoint**: All three scrape targets are `up` and every service exposes metrics. This is the telemetry MVP.

---

## Phase 4: User Story 2 — Observe Request Traffic and Errors (Priority: P1)

**Goal**: HTTP golden signals (request count, error count, latency, in-flight) are available per service and route.

**Independent Test**: Generate mixed traffic, then query Prometheus for request totals, error counts, and p95 latency per service and route.

### Implementation for User Story 2

- [X] T015 [P] [US2] Update `api-gateway/src/metrics.ts` to add an Express middleware that records `http_requests_total` (labels: service, method, route template, status_code), `http_request_duration_seconds` (histogram, labels: service, method, route), `http_requests_in_flight` (gauge, label: service), and `http_errors_total` (counter for 4xx/5xx, labels: service, method, route, status_code). Use the route template, never the concrete path; bucket unknown routes under `route="unmatched"`.
- [X] T016 [P] [US2] Add the same HTTP middleware to `product-service/src/metrics.ts` and register it in `product-service/src/app.ts` before route handlers.
- [X] T017 [P] [US2] Add the same HTTP middleware to `payment-service/src/metrics.ts` and register it in `payment-service/src/app.ts` before route handlers.
- [X] T018 [US2] Add gateway upstream metrics to `api-gateway/src/metrics.ts`: `gateway_upstream_requests_total` (labels: service, upstream, status_code) and `gateway_upstream_duration_seconds` (histogram, labels: service, upstream), recorded around each proxied call.
- [X] T019 [US2] Extend `scripts/telemetry-test.sh` to generate mixed traffic (success and 404/422 responses) and assert `http_requests_total` is non-empty, `http_errors_total` is present, and a p95 latency query returns a finite value.
- [X] T020 [US2] Run `bash scripts/smoke-test.sh` and `bash scripts/telemetry-test.sh`; fix middleware registration, label cardinality, or histogram buckets until both pass.

**Checkpoint**: Request rate, error rate, and p95 latency are queryable per service and route.

---

## Phase 5: User Story 3 — Observe Business Outcomes (Priority: P2)

**Goal**: Business metrics (product count, total stock, payment outcomes) reflect API state within one scrape interval.

**Independent Test**: Create products and payments, then query Prometheus for product count, payment counts by status, and total stock, verifying they match the API.

### Implementation for User Story 3

- [X] T021 [P] [US3] Update `product-service/src/metrics.ts` to define `products_total` (gauge), `products_created_total` (counter), `products_deleted_total` (counter), `stock_total` (gauge), and `db_pool_size`/`db_pool_idle`/`db_pool_waiting` (gauges). Update `product-service/src/store.ts` to increment/decrement these on create/delete and to refresh `products_total` and `stock_total` on read or mutation.
- [X] T022 [P] [US3] Update `payment-service/src/metrics.ts` to define `payments_created_total` (counter), `payments_completed_total` (counter), `payments_failed_total` (counter with bounded `reason` label: `card_declined`, `insufficient_stock`, `processing_failed`, `stock_reservation_failed`), `payments_pending` (gauge), `stock_decrements_total` (counter with `result` label: `success`/`insufficient`), `stock_compensations_total` (counter), and `db_pool_size`/`db_pool_idle`/`db_pool_waiting` (gauges). Update `payment-service/src/store.ts` and `payment-service/src/controllers/paymentController.ts` to increment these at the corresponding state transitions.
- [X] T023 [US3] Extend `scripts/telemetry-test.sh` to create a product and a successful payment, then assert `products_total >= 1`, `payments_completed_total >= 1`, and `stock_total` matches the API's total stock.
- [X] T024 [US3] Run `bash scripts/telemetry-test.sh`; fix business metric increments or gauge refresh logic until assertions pass.

**Checkpoint**: Business metrics reflect API state within one scrape interval.

---

## Phase 6: User Story 4 — Prometheus Runs In The Stack (Priority: P2)

**Goal**: Prometheus is part of the Compose stack, survives restarts and teardown, and requires no manual setup.

**Independent Test**: Run `docker compose up`, open the Prometheus UI, and confirm all targets are discovered automatically; restart and recreate containers without losing scrape configuration.

### Implementation for User Story 4

- [X] T025 [US4] Validate that `prometheus/prometheus.yml` is mounted read-only and that `prometheus_data` persists across `docker compose restart` and `docker compose down` (without `-v`); document the volume in the compose file comments.
- [X] T026 [US4] Extend `scripts/telemetry-test.sh` to restart only the `prometheus` container and re-verify all targets return to `up` within 60 seconds.
- [X] T027 [US4] Run `bash scripts/telemetry-test.sh` after a `docker compose down` + `up -d --wait` cycle; fix startup ordering or health checks until targets recover automatically.

**Checkpoint**: Prometheus requires no manual setup and recovers automatically.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, security/cardinality audit, build hygiene, and full end-to-end validation.

- [X] T028 Update `README.md`: add Prometheus to the architecture; document the `9090` UI, retention (7 days / 1 GB), scrape targets, cardinality rules, and the fact that `/metrics` and scrape traffic stay internal; add telemetry commands to the verification and operations sections.
- [X] T029 [P] Reconcile `specs/004-prometheus-telemetry/quickstart.md` with the implemented scripts, flags, ports, and expected outputs; correct any drift.
- [X] T030 [P] Audit metric safety: review `api-gateway/src/metrics.ts`, `product-service/src/metrics.ts`, `payment-service/src/metrics.ts`, and the store/controller changes to confirm no sensitive data (card numbers, customer info, credentials, IDs) appears in metric labels or values, and that label sets are bounded.
- [X] T031 [P] Audit build/runtime hygiene: run `docker compose build --no-cache`; verify `prom-client` is present in all three runtime images and dev dependencies remain absent; verify containers still run as the non-root `node` user.
- [X] T032 Clean up `api-gateway/src/metrics.ts`, `product-service/src/metrics.ts`, `payment-service/src/metrics.ts`, and the store/controller changes: remove dead code and unused imports; review the final diff to confirm no route paths, response fields, or status codes changed.
- [X] T033 Run the full validation sequence in this order: `bash scripts/smoke-test.sh`, `bash scripts/verify-isolation.sh`, `bash scripts/persistence-test.sh`, `bash scripts/concurrency-test.sh`, `bash scripts/telemetry-test.sh`, `bash scripts/reset-data.sh --yes`, then `bash scripts/smoke-test.sh` again. Leave the stack healthy at `http://localhost:8080` with empty collections.

**Checkpoint**: Documentation, security, build, and all acceptance checks pass; the stack is ready for delivery.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T001–T005 can run in parallel (except T004/T005 are independent files).
- **Foundational (Phase 2)**: Depends on Setup. T006–T008 in parallel; T009–T011 depend on their respective metrics modules; T012 depends on T004.
- **US1 (Phase 3)**: Depends on Foundational.
- **US2 (Phase 4)**: Depends on US1 (refines the same modules).
- **US3 (Phase 5)**: Depends on US2 (adds business metrics to the same modules and stores).
- **US4 (Phase 6)**: Depends on Foundational (compose + config); can run in parallel with US2/US3 but its validation should follow US1.
- **Polish (Phase 7)**: Depends on all desired user stories. T028 must run after earlier docs edits; T030–T031 in parallel; T032 then T033 last.

### User Story Dependencies

| Story | Priority | Depends on | Reason |
|-------|----------|------------|--------|
| US1 — Scrape metrics from every service | P1 | Foundational | Needs `/metrics` endpoints and Prometheus container |
| US2 — Observe request traffic and errors | P1 | US1 | Adds HTTP middleware to the same modules |
| US3 — Observe business outcomes | P2 | US2 | Adds business metrics to stores/controllers |
| US4 — Prometheus runs in the stack | P2 | Foundational | Validates container lifecycle and recovery |

### Within Each User Story

- Module changes before compose/config changes.
- Implementation before script extensions.
- Scripts before their validation runs.
- Fix regressions in the owning service before moving on.

---

## Parallel Opportunities

### Setup

```text
Task: "T001 Add prom-client to api-gateway"
Task: "T002 Add prom-client to product-service"
Task: "T003 Add prom-client to payment-service"
Task: "T004 Create prometheus/prometheus.yml"
```

### Foundational

```text
Task: "T006 Create api-gateway/src/metrics.ts"
Task: "T007 Create product-service/src/metrics.ts"
Task: "T008 Create payment-service/src/metrics.ts"
```

### User Story 2

```text
Task: "T015 HTTP middleware in api-gateway"
Task: "T016 HTTP middleware in product-service"
Task: "T017 HTTP middleware in payment-service"
```

### User Story 3

```text
Task: "T021 Product business metrics"
Task: "T022 Payment business metrics"
```

### Polish

```text
Task: "T030 Audit metric safety"
Task: "T031 Audit build/runtime hygiene"
```

---

## Implementation Strategy

### MVP First (Scrape Increment)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (metrics modules, `/metrics` routes, Prometheus container).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run `bash scripts/telemetry-test.sh`; confirm all three targets are `up`.
5. This is the telemetry MVP: every service is observable.

### Full P1 Release

1. Complete Setup + Foundational + US1.
2. Complete US2 (HTTP golden signals).
3. **VALIDATE**: `bash scripts/smoke-test.sh` and `bash scripts/telemetry-test.sh`.

### Incremental Delivery

1. Foundation + US1 → scrapeable metrics.
2. US2 → request traffic and errors.
3. US3 → business outcomes.
4. US4 → container lifecycle and recovery.
5. Polish → docs, safety audit, build audit, full suite.

---

## Notes

- `scripts/smoke-test.sh` is intentionally **not modified**; it is the API-parity oracle.
- No unit-test framework is introduced; validation is script- and health-check-based.
- No change to existing API routes, payloads, status codes, or persistence behavior.
- Prometheus is the only new container; no Grafana or alerting manager is included.
- Commit after each task or logical group, and stop at each checkpoint to validate the story independently.