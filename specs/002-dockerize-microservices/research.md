# Phase 0 Research: Containerized E-commerce Microservices Stack

**Feature**: `002-dockerize-microservices`
**Date**: 2026-11-10
**Status**: Complete — all technical unknowns resolved

## Decision 1 — Orchestration tool

**Decision**: Use a single root `docker-compose.yml` with Compose v2+ commands (`docker compose up --build -d`).

**Rationale**: Compose is bundled with modern Docker Engine on the target host (verified Compose v5.7.0), expresses the network, health checks, dependencies, and published ports declaratively, and provides a one-command lifecycle that satisfies the spec. It also creates project-scoped resources that are removed together on `down`.

**Alternatives considered**:
- Raw `docker run` scripts: rejected — ordering, network creation, health checks, and teardown become manual and error-prone.
- Kubernetes/Helm: rejected — disproportionate operational overhead for a three-service local stack.
- Separate Compose files per service: rejected — no independent deployments exist yet; a single file is simpler to understand and maintain.

## Decision 2 — Image build strategy

**Decision**: One multi-stage `Dockerfile` per service using `node:22-alpine`. Builder stage runs `npm ci` and `npm run build`; runtime stage installs production dependencies only, copies `dist/`, and runs as the non-root `node` user.

**Rationale**: Produces small, production-shaped images, excludes TypeScript and `ts-node-dev`, avoids running as root, and eliminates the need for Node.js on the host. Node 22 is the current LTS-aligned choice for 2026 and matches the host's v22 runtime; Node 20 is past its support window.

**Alternatives considered**:
- Single-stage image running `ts-node-dev`: rejected — ships dev dependencies, watches files, and is not a production execution mode.
- `ts-node` at runtime: rejected — unnecessary transpilation overhead versus precompiled `dist/`.
- Shared base image across services: rejected — three services do not justify a custom registry/base-image pipeline.
- Distroless image: rejected — complicates health checks and debugging without a meaningful benefit at this scale.

## Decision 3 — Build context and lockfile reproducibility

**Decision**: Use each service directory as its Docker build context, add a `.dockerignore` per service excluding `node_modules`, `dist`, logs, and tests, and commit `package-lock.json` by removing it from the root `.gitignore`.

**Rationale**: `npm ci` requires a lockfile and guarantees identical dependency trees across machines and CI. The lockfiles already exist on disk but are currently ignored, which would break a clean-checkout build. Per-service contexts keep build transfers small and prevent one service's files from invalidating another's cache.

**Alternatives considered**:
- `npm install` without a lockfile: rejected — non-reproducible builds and silent dependency drift.
- Root context with multiple `-f` Dockerfiles: rejected — sends the entire repository, including other services' `node_modules`, to the daemon.
- Committing `node_modules`: rejected — large, platform-specific, and already ignored.

## Decision 4 — Service networking and exposure

**Decision**: Create one user-defined bridge network (`ecommerce`). Attach all three services. Publish only `8080:8080` for the gateway. Address services by DNS name (`product-service`, `payment-service`).

**Rationale**: User-defined bridge networks provide automatic DNS resolution that the default bridge lacks. Publishing only the gateway matches the spec's security/isolation outcome and avoids host port collisions for internal services.

**Alternatives considered**:
- `network_mode: host`: rejected — breaks portability, exposes all ports, and reintroduces `localhost` coupling.
- Default bridge with legacy `links`: rejected — deprecated and offers no DNS benefits.
- Publishing 3001/3002 for convenience: rejected — violates the isolation requirement; can be added temporarily by an operator override when debugging.

## Decision 5 — Runtime configuration

**Decision**: Introduce `PRODUCT_SERVICE_URL` and `PAYMENT_SERVICE_URL` environment variables with local-development defaults (`http://localhost:3001`, `http://localhost:3002`). Compose overrides them with container DNS names. Keep `PORT` support that already exists. Document defaults in `.env.example`.

**Rationale**: The current hardcoded `localhost` addresses fail inside containers because each container has its own network namespace. Environment configuration removes the coupling while keeping the non-containerized workflow working unchanged.

**Alternatives considered**:
- Hardcoding container hostnames: rejected — breaks `npm run dev` on the host.
- A configuration file mounted into containers: rejected — more moving parts than two environment variables.
- Service discovery infrastructure (Consul, etcd): rejected — Compose DNS already solves this.

## Decision 6 — Health checks and startup ordering

**Decision**: Reuse each service's `/health` endpoint. Define Compose health checks with `node -e "fetch('http://localhost:<port>/health')..."`, interval 10s, timeout 3s, retries 5, start period 10s. Gate dependents with `depends_on: condition: service_healthy` and set `restart: unless-stopped`.

**Rationale**: Node 22 includes `fetch`, so no `curl`/`wget` package is needed in Alpine. Health-gated startup prevents the gateway and payment service from serving before targets are ready. `restart: unless-stopped` provides recovery after crashes without fighting an operator-initiated `down`.

**Alternatives considered**:
- `sleep` loops in entrypoints: rejected — fragile and slow.
- No health checks with plain `depends_on`: rejected — only waits for container start, not readiness.
- Installing `curl` in the runtime image: rejected — larger image and an unnecessary package.

## Decision 7 — Payment-to-product resilience

**Decision**: In the payment service, use the configured product-service URL, add a short request timeout (about 3 seconds), and apply bounded retries with backoff for stock validation and decrement calls. Distinguish "product not found" (`404`) from "product service unavailable" (`503`) and stop treating every failure as "not found".

**Rationale**: Cold starts and brief network blips should not permanently fail payments or misreport missing products. Bounded retries keep latency within the 5-second success criterion while avoiding request pile-ups.

**Alternatives considered**:
- No timeout/retry: rejected — a hung dependency can hang the payment request indefinitely.
- Circuit breaker library: rejected — overkill for one internal dependency and adds a dependency.
- Fire-and-forget stock decrement: rejected — silently diverges stock and payment state; current code already logs failures, which remains as a last resort.

## Decision 8 — Graceful shutdown and signal handling

**Decision**: Enable `init: true` in Compose for all services and add `SIGTERM`/`SIGINT` handlers that close the HTTP server. Set a 10-second `stop_grace_period`.

**Rationale**: Node as PID 1 does not reap child processes or reliably apply default signal behavior. An init process plus explicit server shutdown prevents dropped requests and orphaned processes, supporting the clean-teardown success criterion.

**Alternatives considered**:
- Relying on default Node signal behavior: rejected — abrupt termination and possible zombie processes.
- Custom entrypoint shell with `exec`: insufficient alone; `init: true` is simpler and standard.

## Decision 9 — Data persistence scope

**Decision**: Keep in-memory stores. Do not add volumes or a database. Document that products and payments reset on restart.

**Rationale**: Persistence is outside the requested scope and the current system already loses data on restart. Adding a database would expand the feature substantially and is not needed to "put the services to work" in containers.

**Alternatives considered**:
- Serializing Maps to a volume: rejected — ad hoc persistence with poor concurrency semantics.
- Adding PostgreSQL/MongoDB: rejected — new infrastructure, schema, and migration work beyond this feature.
- Named volume for source code (dev mode): rejected — production build is the chosen runtime model.

## Decision 10 — Port-conflict handling

**Decision**: Document stopping the legacy local dev servers before starting the stack, use a project-scoped Compose name, and rely on Compose's explicit binding error for conflicting ports. Do not auto-remap host ports.

**Rationale**: Ports 8080/3001/3002 are currently held by `ts-node-dev` processes. Auto-remapping would break the documented `http://localhost:8080` contract and confuse users. Compose already reports the exact conflicting port, which is actionable.

**Alternatives considered**:
- Automatic random host ports: rejected — breaks the stable public contract.
- Killing host processes automatically: rejected — destructive and surprising.
- Exposing services only through the gateway: already chosen; internal ports are not published, so only 8080 can conflict.

## Decision 11 — Verification approach

**Decision**: Add `scripts/smoke-test.sh` using `curl` against the gateway: health check, product create/read/update/list, payment creation with test card `4111111111111111`, polling for completion, stock decrement verification, and cleanup. Also document the same flow in `quickstart.md`.

**Rationale**: Gives a repeatable, human-runnable proof of the spec's primary flows without introducing a test framework or test dependencies into production images. It directly validates the preserved API contract and internal connectivity.

**Alternatives considered**:
- Adding Jest/Supertest now: rejected — meaningful unit/contract coverage is a larger, separate effort; do not couple it to containerization.
- Manual curl only: rejected — easy to skip steps and miss the asynchronous payment result.
- Container-level `docker compose exec` checks: retained as a debugging complement, not the primary contract test.

## Resolved Unknowns

| Item | Resolution |
|------|------------|
| Container base and Node version | `node:22-alpine` (LTS-aligned, matches host) |
| Orchestration availability | Compose v2+ verified on host (v5.7.0) |
| Lockfile availability on clean checkout | Commit existing `package-lock.json` files; remove ignore rule |
| Current port usage | 8080/3001/3002 occupied by local dev servers; stop before `compose up` |
| Public exposure | Gateway only, host port 8080 |
| Persistent storage | Out of scope; in-memory reset documented |
| Health check mechanism | Node built-in `fetch` against `/health` |
| API compatibility | Unchanged; verified via smoke test and existing OpenAPI contract |
