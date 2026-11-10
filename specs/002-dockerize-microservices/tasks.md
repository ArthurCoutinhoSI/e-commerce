---
description: "Task list for the containerized E-commerce microservices stack"
---

# Tasks: Containerized E-commerce Microservices Stack

**Input**: Design documents from `/specs/002-dockerize-microservices/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: No automated test framework or TDD approach was requested. Verification is provided by `scripts/smoke-test.sh`, `scripts/verify-isolation.sh`, container health checks, and the [quickstart.md](./quickstart.md) validation flow.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and demonstrated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: User story this task belongs to (US1, US2, US3, US4)
- Every task includes exact repository-relative file paths

## Path Conventions

Repository root is the project root:

```text
api-gateway/    product-service/    payment-service/
docker-compose.yml    .env.example    scripts/    README.md
specs/002-dockerize-microservices/
```

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Enable reproducible builds and document runtime configuration.

- [x] T001 Update `.gitignore` to stop ignoring `package-lock.json` (remove the npm lockfile ignore rule) so the three existing lockfiles are tracked; verify with `git check-ignore -v api-gateway/package-lock.json product-service/package-lock.json payment-service/package-lock.json` (must report nothing).
- [x] T002 [P] Create `api-gateway/.dockerignore` excluding `node_modules`, `dist`, `*.log`, `.env`, and local test artifacts.
- [x] T003 [P] Create `product-service/.dockerignore` excluding `node_modules`, `dist`, `*.log`, `.env`, and local test artifacts.
- [x] T004 [P] Create `payment-service/.dockerignore` excluding `node_modules`, `dist`, `*.log`, `.env`, and local test artifacts.
- [x] T005 [P] Create root `.env.example` documenting `PORT` (8080/3001/3002), `NODE_ENV=production`, `PRODUCT_SERVICE_URL=http://localhost:3001`, and `PAYMENT_SERVICE_URL=http://localhost:3002`, with comments explaining the Compose override values.

**Checkpoint**: Build contexts are clean and runtime configuration is documented.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Env-driven service discovery and production images that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T006 [P] Modify `api-gateway/src/app.ts` so proxy targets read `process.env.PRODUCT_SERVICE_URL` (default `http://localhost:3001`) and `process.env.PAYMENT_SERVICE_URL` (default `http://localhost:3002`); preserve the existing `pathRewrite` rules that map `/api/products` → `/products` and `/api/payments` → `/payments`.
- [x] T007 [P] Modify `payment-service/src/controllers/paymentController.ts` to use `process.env.PRODUCT_SERVICE_URL` (default `http://localhost:3001`) instead of hardcoded `http://localhost:3001`; add a 3000 ms Axios timeout and bounded retries (max 3, short backoff) for the stock GET and PATCH calls; return `503 { "error": "Service Unavailable" }` for connection refused/timeouts while preserving `404` for a genuinely missing product, `422` for insufficient stock, and the existing payment success/decline behavior.
- [x] T008 [P] Create `product-service/Dockerfile` as a multi-stage `node:22-alpine` build: builder runs `npm ci` and `npm run build`; runtime sets `NODE_ENV=production`, installs production dependencies only, copies `dist/`, runs as the non-root `node` user, exposes `3001`, and starts with `npx --no-install`-free `node dist/app.js`.
- [x] T009 [P] Create `payment-service/Dockerfile` with the same multi-stage `node:22-alpine` pattern, exposing `3002`, non-root `node` user, production dependencies only, and `node dist/app.js`.
- [x] T010 [P] Create `api-gateway/Dockerfile` with the same multi-stage `node:22-alpine` pattern, exposing `8080`, non-root `node` user, production dependencies only, and `node dist/app.js`.
- [x] T011 Create root `docker-compose.yml` with Compose project name `ecommerce`, user-defined bridge network `ecommerce`, and three services `api-gateway`, `product-service`, `payment-service`; set build contexts/images to `./api-gateway`, `./product-service`, `./payment-service`; wire `PRODUCT_SERVICE_URL=http://product-service:3001` and `PAYMENT_SERVICE_URL=http://payment-service:3002`; publish **only** `8080:8080` on `api-gateway` and no host ports on the backend services (depends on T006–T010).

**Checkpoint**: Images build individually and the Compose topology is defined; user stories can now proceed.

---

## Phase 3: User Story 1 — One-Command Startup of the Full Stack (Priority: P1) 🎯 MVP

**Goal**: `docker compose up --build -d` brings up all three services with the gateway reachable on port 8080 and a clean `docker compose down`.

**Independent Test**: From a clean checkout with only Docker Engine + Compose installed, run the documented start command, confirm all services are healthy and `GET http://localhost:8080/health` returns 200, then run the documented shutdown and confirm no containers, network, or occupied ports remain.

### Implementation for User Story 1

- [x] T012 [US1] Add `/health` health checks for all three services in `docker-compose.yml` using Node's built-in `fetch` (no `curl`): interval `10s`, timeout `3s`, retries `5`, start period `10s`, checking `http://localhost:8080/health`, `http://localhost:3001/health`, and `http://localhost:3002/health` respectively.
- [x] T013 [US1] Add startup ordering and lifecycle policy in `docker-compose.yml`: `depends_on` with `condition: service_healthy` (gateway waits for product and payment; payment waits for product), `restart: unless-stopped`, `init: true`, and `stop_grace_period: 10s` on every service.
- [x] T014 [US1] Update `README.md` with container-first instructions: prerequisites (Docker Engine + Compose), note that the legacy `start-all.sh` / local dev servers must be stopped so port 8080 is free, `docker compose up --build -d`, `docker compose ps`, `docker compose down`, and the gateway URL `http://localhost:8080`.
- [x] T015 [US1] Run `docker compose up --build -d` from the repository root, resolve any build or startup errors in `api-gateway/Dockerfile`, `product-service/Dockerfile`, `payment-service/Dockerfile`, or `docker-compose.yml`, then confirm `docker compose ps` shows all three services healthy and `curl -s http://localhost:8080/health` returns `{"status":"ok","service":"api-gateway"}`.

**Checkpoint**: The stack is runnable with one command and removable with one command.

---

## Phase 4: User Story 2 — Unchanged API Access Through the Gateway (Priority: P1)

**Goal**: Every existing product and payment operation behaves identically when called through port 8080.

**Independent Test**: Run `bash scripts/smoke-test.sh` against the running stack; it must pass health, product CRUD, payment completion, stock decrement, and 404 error-shape checks without any direct backend calls.

### Implementation for User Story 2

- [x] T016 [P] [US2] Create `scripts/smoke-test.sh` covering gateway health and product create/list/get/update/delete through `http://localhost:8080/api/products`, asserting HTTP `201`/`200`/`204` and required response fields (`id`, `name`, `description`, `price`, `stockQuantity`, `createdAt`, `updatedAt`); exit non-zero on the first failed assertion.
- [x] T017 [US2] Extend `scripts/smoke-test.sh` with the payment flow through `http://localhost:8080/api/payments`: create a payment with card `4111111111111111`, poll `GET /api/payments/:id` until `status` is `completed` (max 10 seconds), verify product `stockQuantity` decreased by 1, and assert `404` for an unknown route and for a missing product (depends on T016).
- [x] T018 [US2] Run `bash scripts/smoke-test.sh` against the stack and fix any route, payload, or status-code regressions in `api-gateway/src/app.ts` and `product-service/src/controllers/productController.ts` while keeping the contract in `specs/002-dockerize-microservices/contracts/http-api.md` unchanged.

**Checkpoint**: The public API is byte-compatible with the original service behavior.

---

## Phase 5: User Story 3 — Internal Service Isolation and Discovery (Priority: P2)

**Goal**: Only the gateway is reachable from the host, and backend services find each other by DNS name.

**Independent Test**: Run `bash scripts/verify-isolation.sh`; it must prove host access to ports 3001/3002 fails and that a payment still reaches the product service through the internal network.

### Implementation for User Story 3

- [x] T019 [US3] Verify and, if needed, correct `docker-compose.yml` so `product-service` and `payment-service` publish no host ports, the `ecommerce` network is shared by all three services, and the gateway/payment environment values resolve to `http://product-service:3001` and `http://payment-service:3002`; confirm with `docker compose config` that only one `published: "8080"` entry exists.
- [x] T020 [P] [US3] Create `scripts/verify-isolation.sh` that asserts `curl` to `http://localhost:3001/health` and `http://localhost:3002/health` fails from the host, asserts the gateway is reachable, and asserts a payment succeeds (proving the payment→product DNS path) — exit non-zero on any failure.
- [x] T021 [US3] Run `bash scripts/verify-isolation.sh` against the stack and resolve any internal connectivity failures in `docker-compose.yml` or `payment-service/src/controllers/paymentController.ts`.

**Checkpoint**: Host exposure is limited to the gateway and inter-service discovery works without `localhost`.

---

## Phase 6: User Story 4 — Operational Visibility and Clean Recovery (Priority: P3)

**Goal**: Operators can detect readiness, read all logs with one command, and restart/teardown without orphans.

**Independent Test**: Read all logs with one command, restart a container and see it rejoin, run `down` and confirm no resources remain, then start again and confirm products return `[]`.

### Implementation for User Story 4

- [x] T022 [P] [US4] Add `SIGTERM`/`SIGINT` handlers in `api-gateway/src/app.ts` that stop accepting connections, close the HTTP server, and exit `0`, while keeping the existing startup behavior.
- [x] T023 [P] [US4] Add the same graceful shutdown handlers in `product-service/src/app.ts`.
- [x] T024 [P] [US4] Add the same graceful shutdown handlers in `payment-service/src/app.ts`.
- [x] T025 [US4] Update `README.md` with operational commands and troubleshooting: `docker compose logs -f`, `docker compose ps`, `docker compose restart`, `docker compose down`, port-8080 conflict guidance, unhealthy-service diagnosis, and an explicit note that in-memory product/payment data resets on restart.
- [x] T026 [US4] Validate recovery and teardown: restart a service and confirm it becomes healthy, read logs for all services with one command, run `docker compose down` and confirm no containers/network/port 8080 remain, then `docker compose up -d` and confirm `GET /api/products` returns `[]` (files: `docker-compose.yml`, `specs/002-dockerize-microservices/quickstart.md`).

**Checkpoint**: All four user stories are functional and independently verifiable.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening and documentation consistency.

- [x] T027 [P] Execute the full validation flow in `specs/002-dockerize-microservices/quickstart.md` from a clean state and fix any discrepancies in `docker-compose.yml`, the service `Dockerfile`s, or the scripts.
- [x] T028 [P] Audit `api-gateway/Dockerfile`, `product-service/Dockerfile`, and `payment-service/Dockerfile` for non-root execution, production-only dependencies, no baked secrets, `NODE_ENV=production`, and complete `.dockerignore` coverage in each service directory.
- [x] T029 [P] Fix `start-all.sh` to derive its directory from the script location (for example, `cd "$(dirname "$0")"`) instead of the hardcoded `/home/debianserver/...` path so the legacy local workflow still works after the container-first change.
- [x] T030 Update the documentation links in `README.md` to reference `specs/002-dockerize-microservices/quickstart.md`, `specs/002-dockerize-microservices/contracts/http-api.md`, and `specs/002-dockerize-microservices/contracts/container-runtime.md`, and ensure no stale instructions contradict the container-first workflow (depends on T025).

**Checkpoint**: Documentation and legacy tooling are consistent with the containerized stack.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; start immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational. Produces the runnable stack.
- **User Story 2 (Phase 4)**: Depends on User Story 1 (needs a running stack for validation); script creation can overlap with US1 completion.
- **User Story 3 (Phase 5)**: Depends on User Story 1; independent of US2 (separate script).
- **User Story 4 (Phase 6)**: Depends on User Story 1; independent of US2/US3 except for the shared `README.md` edit order.
- **Polish (Phase 7)**: Depends on all desired user stories.

### User Story Dependencies

- **US1 (P1)**: No story dependencies — MVP baseline.
- **US2 (P1)**: Requires US1's running stack; verifies API parity.
- **US3 (P2)**: Requires US1's running stack; verifies isolation and DNS.
- **US4 (P3)**: Requires US1; adds resilience and operator workflows.
- US2 and US3 touch different scripts and can proceed in parallel after US1.
- US4 shutdown tasks touch three different `app.ts` files and can proceed in parallel.

### Within Each User Story

- Setup files before build definitions.
- Env-driven code and Dockerfiles before the Compose topology.
- Compose topology before health checks and ordering.
- Scripts before running their validation.
- Fix regressions before declaring a story complete.

### Parallel Opportunities

- Phase 1: T002, T003, T004, T005 in parallel (different files); T001 independently.
- Phase 2: T006, T007, T008, T009, T010 in parallel (different files); T011 after them.
- Phase 6: T022, T023, T024 in parallel (different `app.ts` files).
- Phase 7: T027, T028, T029 in parallel; T030 after T025.
- After US1: US2 (T016–T018) and US3 (T019–T021) can run concurrently by different developers.

---

## Parallel Example: Phase 2

```bash
# Launch env-driven code changes and image definitions together:
Task: "Update proxy targets in api-gateway/src/app.ts (T006)"
Task: "Update product URL/timeout/retry in payment-service/src/controllers/paymentController.ts (T007)"
Task: "Create product-service/Dockerfile (T008)"
Task: "Create payment-service/Dockerfile (T009)"
Task: "Create api-gateway/Dockerfile (T010)"
# Then create docker-compose.yml once these complete (T011)
```

## Parallel Example: User Story 4

```bash
# Graceful shutdown in three independent files:
Task: "Add SIGTERM/SIGINT handlers in api-gateway/src/app.ts (T022)"
Task: "Add SIGTERM/SIGINT handlers in product-service/src/app.ts (T023)"
Task: "Add SIGTERM/SIGINT handlers in payment-service/src/app.ts (T024)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: all services healthy, gateway reachable, clean `down`.
5. Demo the running stack.

### Recommended P1 Increment

Complete **US1 + US2** together. Both are P1: US1 proves the stack starts, and US2 proves the existing API contract truly works through the gateway. This is the smallest increment that satisfies the user's request to "put the microservices and API gateway to work."

### Incremental Delivery

1. Setup + Foundational → images build, topology defined.
2. US1 → stack starts and stops with one command (MVP).
3. US2 → API parity proven by smoke test.
4. US3 → isolation and internal DNS proven.
5. US4 → operational visibility and clean recovery.
6. Polish → full quickstart validation and documentation hardening.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. One developer completes US1 (running stack).
3. After US1:
   - Developer A: US2 (smoke test + API parity).
   - Developer B: US3 (isolation verification).
   - Developer C: US4 (shutdown, operations, recovery).
4. Merge and run Phase 7 polish together.

---

## Notes

- `[P]` tasks touch different files and have no incomplete dependencies.
- Story labels map directly to [spec.md](./spec.md) user stories.
- Every task names the exact file(s) to create or modify.
- Do not add persistence, Kubernetes, registry publishing, TLS, or authentication — explicitly out of scope.
- Stop at each checkpoint to validate the story independently before moving on.
