# Phase 1 Data Model: Containerized E-commerce Microservices Stack

**Feature**: `002-dockerize-microservices`
**Date**: 2026-11-10

This feature introduces runtime/deployment entities. The existing domain entities (`Product`, `Payment`) are unchanged and remain stored in memory inside their respective services; see [spec.md](./spec.md#key-entities-include-if-data-involved). No database schema or migration is introduced.

## 1. Service Container

Represents one runnable service in the stack.

| Field | Description | Gateway | Product | Payment |
|-------|-------------|---------|---------|---------|
| name | Compose service/DNS name | `api-gateway` | `product-service` | `payment-service` |
| build context | Directory used for image build | `./api-gateway` | `./product-service` | `./payment-service` |
| image | Local image tag | `ecommerce/api-gateway:local` | `ecommerce/product-service:local` | `ecommerce/payment-service:local` |
| internal port | Container listening port | `8080` | `3001` | `3002` |
| published port | Host binding | `8080:8080` | none | none |
| health endpoint | Readiness probe | `/health` | `/health` | `/health` |
| restart policy | Recovery behavior | `unless-stopped` | `unless-stopped` | `unless-stopped` |
| init process | PID 1 signal handling | `true` | `true` | `true` |
| dependencies | Startup ordering | product, payment (healthy) | none | product (healthy) |

**Validation rules**
- Service names MUST be unique and DNS-safe (lowercase, digits, hyphens).
- Internal ports MUST match the port the application listens on (`PORT`).
- Exactly one service (the gateway) MUST declare a host `ports` mapping.
- Every service MUST define a health check and a restart policy.
- Images MUST run as a non-root user and start the compiled application.

**Relationships**
- A service belongs to exactly one stack/network.
- The gateway depends on both backend services; the payment service depends on the product service.
- No service mounts a data volume.

## 2. Internal Network

Defines the private communication boundary.

| Field | Value / Rule |
|-------|--------------|
| name | `ecommerce` (Compose-managed, project-scoped) |
| driver | `bridge` (user-defined) |
| members | `api-gateway`, `product-service`, `payment-service` |
| DNS | Service names resolve to container IPs on this network |
| host exposure | Only the gateway port `8080` is reachable from the host |
| lifecycle | Created on `up`, removed on `down` |
| collision rule | Resource names MUST be scoped to the Compose project to avoid clashes with unrelated stacks |

**Invariants**
- Backend service ports MUST NOT be published to the host by default.
- No service MAY depend on a hardcoded host IP or `localhost` for inter-service calls.

## 3. Runtime Configuration

Environment-driven settings applied at container start.

| Variable | Applies to | Default (local) | Stack value | Validation |
|----------|-----------|-----------------|-------------|------------|
| `PORT` | all | 8080 / 3001 / 3002 | same as internal port | integer 1–65535 |
| `PRODUCT_SERVICE_URL` | gateway, payment | `http://localhost:3001` | `http://product-service:3001` | absolute `http(s)` URL |
| `PAYMENT_SERVICE_URL` | gateway | `http://localhost:3002` | `http://payment-service:3002` | absolute `http(s)` URL |
| `NODE_ENV` | all | `development` | `production` | `production` in images |

**Rules**
- Application code MUST NOT hardcode container hostnames; defaults preserve the non-containerized dev workflow.
- URLs MUST NOT include trailing `/products` or `/payments` path segments; routing paths are appended by the application.
- Missing or malformed values SHOULD fall back to documented defaults, except in the stack where Compose supplies explicit values.
- Secrets are out of scope; no credentials are required by this feature.

## 4. Health Status

Readiness signal exposed by every service.

**Response contract**

```json
{ "status": "ok", "service": "<service-name>" }
```

| Field | Type | Rule |
|-------|------|------|
| `status` | string | MUST be `ok` when the process can serve requests |
| `service` | string | MUST identify the service (`api-gateway`, `product-service`, `payment-service`) |

**State transitions**

```text
starting ──(health check passes)──> healthy
starting ──(retries exhausted)────> unhealthy
healthy  ──(health check fails)───> unhealthy
unhealthy ──(restart + pass)──────> healthy
```

- `starting` is allowed during the configured start period and MUST NOT gate dependents as ready.
- `unhealthy` triggers container restart under `unless-stopped` when the process has exited; operators can inspect status via `docker compose ps`.
- Health checks MUST complete within the configured timeout and MUST NOT require external network access.

## 5. Stack Lifecycle

Represents the lifecycle of the whole stack.

```text
absent ──up --build──> starting ──all healthy──> running
running ──stop──> stopped ──start──> starting
running/stopped ──down──> absent
running ──container crash──> restarting ──healthy──> running
```

| State | Meaning | Operator-visible signal |
|-------|---------|-------------------------|
| absent | No stack containers or network exist | `docker compose ps` empty / command reports none |
| starting | Images built, containers starting, health not yet passing | `ps` shows `starting`/`unhealthy`; startup command still waiting |
| running | All services healthy and gateway reachable | `GET http://localhost:8080/health` returns 200 `ok` |
| stopped | Containers exist but are not running | `ps` shows exited/stopped; ports released |
| restarting | A container exited and is being restarted | `ps` shows restarting; logs show the failure |

**Rules**
- `up` MUST be idempotent: repeated invocations converge on `running` without duplicate containers.
- `down` MUST remove containers and the network and release all host ports; no orphaned resources remain.
- A restart MUST reset in-memory `Product` and `Payment` data; this is expected, not a failure.
- Startup failure MUST surface the failing service or conflicting port within 30 seconds.

## 6. Existing Domain Entities (unchanged)

| Entity | Location | Persistence | Impact of this feature |
|--------|----------|-------------|------------------------|
| `Product` | `product-service/src/models/Product.ts`, `store.ts` | In-memory `Map` | None to fields or rules; data resets on container restart |
| `Payment` | `payment-service/src/models/Payment.ts`, `store.ts` | In-memory `Map` | None to fields or rules; product lookup now uses configured URL |

**Cross-service relationship**: A `Payment` references a `productId`; the payment service reads and decrements the corresponding `Product` through the internal network. This relationship is unchanged, but its transport is now container-DNS-based rather than `localhost`.

## 7. Derived Validation Matrix

| Requirement | Data-model check |
|-------------|------------------|
| FR-004 / FR-005 | Only `api-gateway.publishedPort` is set |
| FR-006 / FR-007 | `PRODUCT_SERVICE_URL` and `PAYMENT_SERVICE_URL` point to service DNS names |
| FR-008 | All runtime endpoints come from the configuration table |
| FR-011 | Every service has a health endpoint and health-check definition |
| FR-014 | Services emit logs to stdout/stderr collected by the stack |
| FR-016 | Network and service resources are project-scoped |
| FR-018 | No volumes; domain stores are process-local |
