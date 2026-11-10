# Implementation Plan: Containerized E-commerce Microservices Stack

**Branch**: `002-dockerize-microservices` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-dockerize-microservices/spec.md`

## Summary

Package the existing three Node.js/TypeScript services (API gateway, product service, payment service) into production-style container images and orchestrate them with a single root Docker Compose stack. The gateway remains the only host-published entry point on port 8080; product and payment services communicate over a private bridge network using service DNS names. Application code is changed only where required: proxy targets and product-service calls become environment-driven, services gain graceful shutdown, and dependency calls become resilient to cold-start unavailability. Existing HTTP routes, payloads, and status codes remain unchanged.

## Technical Context

**Language/Version**: TypeScript 5.2 compiled to CommonJS ES2020; Node.js 22 LTS in runtime images (matches the host's Node 22 and avoids the Node 20 end-of-life window). Host Node is not required to run the stack.

**Primary Dependencies**: Express 4.18, `http-proxy-middleware` 2.0.6, `axios` 1.6, `uuid` 9, `cors` 2.8. Build-time only: TypeScript 5.2, `ts-node-dev`, `@types/*`. No new application framework is introduced.

**Storage**: In-memory `Map` stores inside the product and payment services. No database, volume, or persistence layer is added; state resets on container restart.

**Testing**: No automated test suite exists today. Verification uses container health checks plus a new `scripts/smoke-test.sh` that exercises the product CRUD flow and the payment/stock flow through the gateway. Unit tests for service logic remain out of scope for this deployment feature.

**Target Platform**: Linux host with Docker Engine 24+ and Compose v2+ (verified locally: Docker 29.9.3, Compose v5.7.0), amd64 primary and arm64 buildable.

**Project Type**: Multi-service web backend (three independently deployable HTTP services in one repository).

**Performance Goals**: Full stack serving within 60 seconds; individual health checks answered within 10 seconds of startup; payment flow through the gateway including stock validation/decrement under 5 seconds.

**Constraints**: Only port 8080 published to the host; product/payment ports internal; no host Node.js/npm needed; production build only (no `ts-node-dev` in containers); images run as non-root; dependency calls must tolerate transient startup unavailability; in-memory data is intentionally ephemeral; lockfiles must be committed for reproducible builds.

**Scale/Scope**: Three services, one replica each, one shared network, local developer workstation scope. No cloud, Kubernetes, autoscaling, or registry publishing.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` contains only the unratified scaffold placeholders (`[PRINCIPLE_1_NAME]`, `[SECTION_2_NAME]`, etc.) and declares no concrete principles, constraints, or governance rules. There are no enforceable gates to evaluate.

- **Gate result**: PASS (no ratified principles to violate).
- **Observation**: The constitution should be ratified in a separate step. Until then, this plan follows the project's existing conventions and the spec's constraints.
- **Post-Phase 1 re-check**: PASS — design introduces no architecture beyond the requested containerization and preserves the existing API contract.

## Project Structure

### Documentation (this feature)

```text
specs/002-dockerize-microservices/
├── plan.md              # This file
├── research.md          # Phase 0 decisions and rationale
├── data-model.md        # Runtime entities and state transitions
├── quickstart.md        # End-to-end validation guide
├── contracts/
│   ├── http-api.md      # Preserved gateway contract + verification
│   └── container-runtime.md # Images, env vars, ports, health, lifecycle
└── tasks.md             # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
e-commerce/
├── docker-compose.yml           # NEW: stack definition (gateway, product, payment, network)
├── .env.example                 # NEW: documented runtime configuration defaults
├── .gitignore                   # MODIFIED: stop ignoring package-lock.json
├── README.md                    # MODIFIED: container-first run instructions
├── api-gateway/
│   ├── Dockerfile               # NEW: multi-stage production image
│   ├── .dockerignore            # NEW
│   ├── package.json             # unchanged
│   ├── package-lock.json        # now tracked
│   └── src/app.ts               # MODIFIED: env-driven proxy targets, graceful shutdown
├── product-service/
│   ├── Dockerfile               # NEW: multi-stage production image
│   ├── .dockerignore            # NEW
│   ├── package-lock.json        # now tracked
│   └── src/app.ts               # MODIFIED: graceful shutdown
├── payment-service/
│   ├── Dockerfile               # NEW: multi-stage production image
│   ├── .dockerignore            # NEW
│   ├── package-lock.json        # now tracked
│   ├── src/app.ts               # MODIFIED: graceful shutdown
│   └── src/controllers/paymentController.ts # MODIFIED: env-driven product URL, timeout/retry
├── scripts/
│   └── smoke-test.sh            # NEW: gateway-level end-to-end verification
└── start-all.sh                 # unchanged (legacy local workflow)
```

**Structure Decision**: Keep one Dockerfile per service with that service directory as the build context, rather than a single root Dockerfile. This keeps image builds small and lets each service evolve independently, while a single root `docker-compose.yml` provides the one-command lifecycle required by the spec. A shared base image or monorepo build orchestrator would add complexity without a second consumer.

## Implementation Approach

1. **Reproducible builds**: multi-stage Dockerfiles using `node:22-alpine`: builder installs all dependencies with `npm ci`, runs `npm run build`; runtime installs production dependencies only, copies `dist/`, sets `NODE_ENV=production`, runs as the non-root `node` user with `npm start`.
2. **Configuration**: replace hardcoded `http://localhost:3001` / `http://localhost:3002` with `PRODUCT_SERVICE_URL` and `PAYMENT_SERVICE_URL` environment variables that default to the current local values. Compose sets them to `http://product-service:3001` and `http://payment-service:3002`.
3. **Networking**: one user-defined bridge network `ecommerce`; only `api-gateway` declares `ports: "8080:8080"`. Service names provide DNS resolution.
4. **Health and ordering**: each service exposes its existing `/health` endpoint. Compose health checks use Node's built-in `fetch` (no `curl` in Alpine). `depends_on` with `condition: service_healthy` orders startup; `restart: unless-stopped` recovers crashed containers.
5. **Resilience**: add short timeouts and bounded retries with backoff around payment-to-product calls, and return a clear `503`/existing `404` response when the product service is unavailable instead of an unhandled failure.
6. **Lifecycle**: `init: true` in Compose plus `SIGTERM`/`SIGINT` handlers that stop accepting connections and close the HTTP server; document `up --build -d`, `ps`, `logs -f`, `down`, and `down -v`.
7. **Port-conflict safety**: document that the legacy `start-all.sh` process must be stopped first (ports 3001/3002/8080 are currently occupied by local dev servers) and rely on Compose's explicit port-binding error, which names the conflicting port.
8. **Verification**: `scripts/smoke-test.sh` creates a product, reads it, submits a payment with the success test card, waits for asynchronous processing, verifies payment completion and stock decrement, then cleans up.

## Complexity Tracking

> No constitution gates exist, so there are no violations to justify.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
