# Feature Specification: Prometheus Telemetry

**Feature Branch**: `004-prometheus-telemetry`
**Created**: 2026-11-10
**Status**: Draft
**Input**: User description: "i wanna run a telemetry in this project, like prometheus"

## Clarifications

### Session 2026-11-10

- Q: Should the Prometheus web UI be published to the host? → A: Yes, published on host port 9090.
- Q: Which metrics exposition format should the services implement? → A: Prometheus text format 0.0.4.
- Q: What retention period and storage cap should Prometheus use? → A: 7 days or 1 GB, whichever comes first.
- Q: How should per-product stock be exposed without product id labels? → A: Report total stock (single gauge) plus product count; per-product stock via API.
- Q: What concrete overhead budget should telemetry add? → A: Less than 5 ms of added p95 latency per request.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scrape Metrics From Every Service (Priority: P1)

As an operator, I want each service to expose a standard metrics endpoint so that a Prometheus instance can scrape them without per-service custom integration.

**Why this priority**: Without a uniform, scrapeable metrics source there is nothing to observe. This is the foundation for all other telemetry value.

**Independent Test**: Start the stack, open Prometheus targets, and confirm every service target reports `up=1` and returns a non-empty metrics document in Prometheus text format.

**Acceptance Scenarios**:

1. **Given** the stack is running, **When** Prometheus scrapes a service, **Then** the target is reported as `up` and the response is valid Prometheus exposition format.
2. **Given** a service is restarting, **When** Prometheus scrapes it, **Then** the scrape is recorded as a failure for that interval and recovers automatically once the service is healthy again.
3. **Given** no scrape has ever succeeded, **When** an operator opens the metrics endpoint directly, **Then** the service still returns its current metric values (including zero-valued counters).

### User Story 2 - Observe Request Traffic and Errors (Priority: P1)

As an operator, I want request counts, error rates, and request latency for each service so that I can detect degradation and investigate incidents.

**Why this priority**: Request-level golden signals are the most actionable telemetry for a web API and are required to know whether the system is healthy.

**Independent Test**: Generate a mix of successful and failing requests, then query Prometheus for total requests, error count, and latency percentiles per service and route.

**Acceptance Scenarios**:

1. **Given** traffic has been sent to a service, **When** an operator queries request totals, **Then** counts are broken down by service, HTTP method, route, and status code.
2. **Given** a request fails with a 4xx or 5xx status, **When** metrics are scraped, **Then** the failure is counted in an error metric distinct from successful requests.
3. **Given** requests take measurable time, **When** an operator queries latency, **Then** a histogram is available with enough buckets to compute p50, p95, and p99.

### User Story 3 - Observe Business Outcomes (Priority: P2)

As an operator, I want business-level metrics (products, payments, stock) so that I can monitor catalog and transaction health, not just HTTP traffic.

**Why this priority**: HTTP metrics alone cannot distinguish "no traffic" from "traffic but every payment fails". Business metrics close that gap.

**Independent Test**: Create products and payments, then query Prometheus for product count, payment counts by status, and stock changes, verifying they match the API state.

**Acceptance Scenarios**:

1. **Given** products exist, **When** metrics are scraped, **Then** a gauge reports the current number of products.
2. **Given** payments are created and processed, **When** metrics are scraped, **Then** counters report payments created and payments completed/failed.
3. **Given** stock changes through purchases or manual adjustment, **When** metrics are scraped, **Then** the current stock level is reported per product without exposing product identifiers as high-cardinality labels.

### User Story 4 - Prometheus Runs In The Stack (Priority: P2)

As an operator, I want Prometheus to run as part of the containerized stack so that metrics collection requires no separate installation or host setup.

**Why this priority**: A separately installed Prometheus would reintroduce the manual setup the project deliberately avoids.

**Independent Test**: Run `docker compose up`, then open the Prometheus UI and confirm all targets are discovered automatically from configuration.

**Acceptance Scenarios**:

1. **Given** the stack starts, **When** Prometheus becomes ready, **Then** it discovers and scrapes every service target without manual configuration.
2. **Given** a service container restarts, **When** Prometheus next scrapes, **Then** the target recovers and historical series continue.
3. **Given** the stack is torn down with `docker compose down`, **When** it is started again, **Then** Prometheus starts with the configured scrape targets and a documented retention period.

### Edge Cases

- What happens when a service is down during a scrape? Prometheus records `up=0` for that interval; no partial or corrupt metric document is required from the unavailable service.
- What happens when metric labels would create unbounded cardinality (for example per-product or per-payment identifiers)? Such labels must be avoided; aggregates or bounded enums are used instead.
- What happens when the metrics endpoint is called very frequently? It must return current values without mutating application state and without significant overhead.
- What happens when Prometheus storage fills or expires? Data older than the configured retention period is dropped automatically; services and the API are unaffected.
- What happens when a metric name collides across services? Each metric must be namespaced by service or carry a `service` label so series remain distinguishable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every service (API gateway, product service, payment service) MUST expose an HTTP endpoint that returns metrics in Prometheus text exposition format (version 0.0.4).
- **FR-002**: The metrics endpoint MUST be reachable by Prometheus over the internal container network.
- **FR-003**: Prometheus MUST run as a container in the Compose stack and scrape all service targets automatically from a committed configuration file.
- **FR-004**: Each service MUST report, at minimum: total HTTP requests, HTTP requests by status code class, request duration, and in-flight requests.
- **FR-005**: Each service MUST report process/runtime health metrics (for example uptime and memory usage) using the standard exposition conventions.
- **FR-006**: The product service MUST report the current number of products and the total stock across all products as gauges. Per-product stock MUST NOT be reported as a labeled metric; it remains available through the product API.
- **FR-007**: The payment service MUST report payments created and payments completed/failed as counters, and the current number of pending payments as a gauge.
- **FR-008**: Metric labels MUST be bounded (for example method, route, status class, service). Identifiers such as product IDs, payment IDs, and user identifiers MUST NOT be used as label values.
- **FR-009**: The metrics endpoint MUST NOT expose sensitive data such as card numbers, customer personal information, credentials, or request bodies.
- **FR-010**: Prometheus MUST be configured with a retention period of 7 days or 1 GB of storage, whichever comes first.
- **FR-011**: The Prometheus web UI MUST be published to the host on port 9090 for operator access; service metrics endpoints and Prometheus scrape traffic MUST remain on the internal network.
- **FR-012**: Adding telemetry MUST NOT change any existing HTTP API route, request shape, response shape, or status code.
- **FR-013**: Telemetry failures (for example a scrape timeout) MUST NOT affect request handling or API availability.

### Key Entities

- **Metric Endpoint**: The HTTP path each service exposes for scraping, returning current metric values in Prometheus text format.
- **Scrape Target**: A service instance Prometheus is configured to poll on a fixed interval.
- **Metric Series**: A named measurement with a set of bounded labels and a value.
- **Prometheus Instance**: The containerized time-series database that stores scraped metrics and serves queries.
- **Retention Policy**: The configured duration and storage cap after which old samples are discarded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can confirm all service targets are `up` in Prometheus within 2 minutes of starting the stack.
- **SC-002**: Request rate, error rate, and p95 latency for any service are queryable without modifying application code.
- **SC-003**: Business metrics (product count, payment outcomes, stock) reflect API state within one scrape interval.
- **SC-004**: No metric label set grows unbounded with traffic or data volume; cardinality remains stable under load.
- **SC-005**: No sensitive field appears in any scraped metric document.
- **SC-006**: Existing smoke, persistence, concurrency, isolation, and reset checks continue to pass unchanged after telemetry is added.
- **SC-007**: Telemetry adds less than 5 ms to the p95 request latency of any service.

## Assumptions

- Prometheus is the chosen telemetry backend; other backends are out of scope.
- Grafana and alerting managers are out of scope for this feature; Prometheus querying is sufficient.
- Authentication and TLS for Prometheus are out of scope, consistent with the project's existing no-auth, local-development scope.
- Metrics are pull-based (Prometheus scrapes services); push-based telemetry is out of scope.
- The existing Docker network and service discovery (DNS names) are reused for scrape targets.
- Retention defaults to a short, documented period suitable for local development (for example 7 days or a small storage cap).

## Notes

- This feature adds observability only. It must not alter the existing API contract or persistence behavior established by features 001–003.