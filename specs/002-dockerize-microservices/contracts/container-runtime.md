# Contract: Container Runtime and Operator Interface

**Feature**: `002-dockerize-microservices`
**Status**: New deployment interface

This contract defines what the container stack exposes to operators and to the host. Application implementation details are intentionally excluded; they belong in `tasks.md` and the implementation phase.

## Stack Identity

| Property | Value |
|----------|-------|
| Compose project | `ecommerce` (scoped; set explicitly to avoid host-wide name collisions) |
| Network | `ecommerce` (user-defined bridge, project-scoped) |
| Compose file | `docker-compose.yml` at repository root |
| Host prerequisite | Docker Engine 24+ with Compose v2+ |

## Services

| Compose service | Image tag | Internal port | Host port | Health path |
|-----------------|-----------|---------------|-----------|-------------|
| `api-gateway` | `ecommerce/api-gateway:local` | 8080 | `8080` | `/health` |
| `product-service` | `ecommerce/product-service:local` | 3001 | none | `/health` |
| `payment-service` | `ecommerce/payment-service:local` | 3002 | none | `/health` |

**Rules**
- Only `api-gateway` MAY publish a host port.
- All images MUST run the compiled application, as a non-root user, with `NODE_ENV=production`.
- All services MUST run with an init process and a `unless-stopped` restart policy.

## Environment Contract

| Variable | Consumer(s) | Default | Stack value |
|----------|-------------|---------|-------------|
| `PORT` | each service | service-specific | service-specific |
| `NODE_ENV` | all | `development` | `production` |
| `PRODUCT_SERVICE_URL` | gateway, payment | `http://localhost:3001` | `http://product-service:3001` |
| `PAYMENT_SERVICE_URL` | gateway | `http://localhost:3002` | `http://payment-service:3002` |

- Values MUST be overridable without rebuilding images.
- Defaults MUST keep the existing host-only `npm run dev` workflow functional.
- No secrets or credentials are part of this contract.

## Health Check Contract

- Endpoint: `GET /health` on each service's internal port.
- Success: HTTP `200` and JSON `{ "status": "ok", "service": "<name>" }`.
- Checker: Node's built-in `fetch`; no external binary dependency.
- Timing: interval 10s, timeout 3s, retries 5, start period 10s.
- Startup ordering: gateway waits for both backends; payment service waits for product service.
- Failure: a service that exhausts retries is reported unhealthy by `docker compose ps` and restarted if it has exited.

## Lifecycle Interface

| Operation | Command | Expected result |
|-----------|---------|-----------------|
| Build + start | `docker compose up --build -d` | All three services reach healthy; gateway on `:8080` |
| Status | `docker compose ps` | One row per service with health state |
| Logs (all) | `docker compose logs -f` | Interleaved stdout/stderr from all services |
| Logs (one) | `docker compose logs -f api-gateway` | Gateway logs only |
| Stop | `docker compose stop` | Containers stopped; ports released; state discarded |
| Remove | `docker compose down` | Containers and network removed; no orphans |
| Rebuild | `docker compose build --no-cache` | Fresh images from current sources |
| Full reset | `docker compose down --rmi local` | Containers, network, and local images removed |

- `up` MUST be idempotent.
- `down` MUST release host ports and remove the network.
- No named volumes are declared; `down -v` is equivalent to `down` for this stack.

## Failure Contract

| Failure | Required behavior |
|---------|-------------------|
| Host port 8080 in use | Compose fails and identifies port 8080; no partially running stack is reported as successful |
| Compose not installed | Documented prerequisite; command fails with a clear "unknown command" error |
| Backend image build failure | Build step fails naming the failing service; no stale image is silently reused |
| Backend unavailable at runtime | Gateway returns `502/503`-class response; payment service returns explicit `503` rather than `404` |
| Container crash | Restart policy restarts it; health re-evaluated; gateway resumes routing when healthy |
| Dependency not yet ready | Dependents wait via health-gated `depends_on`; bounded retries cover residual races |
| No network during build | Build fails at dependency fetch with a visible error |

## Data Contract

- No volumes or external storage.
- All `Product` and `Payment` records are process-local and reset on restart, `down`, or rebuild.
- Operators MUST be told this explicitly; it is not a defect.

## Out of Scope

- Registry publishing, image signing, and CI pipelines.
- TLS termination, authentication, rate limiting.
- Kubernetes, cloud provisioning, horizontal scaling, and multi-replica coordination.
- Persistent storage and data migration.
