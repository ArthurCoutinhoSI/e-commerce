# Tasks: Persistent Database Service in a Separate Container

**Input**: Design documents from `/specs/003-containerized-database/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/database-runtime.md, contracts/data-schema.md, quickstart.md

**Tests**: No unit-test framework is requested. The shell scripts below are required validation deliverables from the plan and quickstart, so they are included as implementation tasks rather than TDD tests. `scripts/smoke-test.sh` is reused unchanged.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Maps to the user story in spec.md (`US1`–`US4`)
- Every task includes exact repository-relative file paths
- No `[P]` on tasks that edit the same file as another incomplete task

## Path Conventions

This is an existing multi-service repository. Paths are repository-relative:

- `docker-compose.yml`, `.env.example`, `README.md`
- `database/init/`
- `product-service/src/`, `payment-service/src/`
- `scripts/`
- `specs/003-containerized-database/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the database client dependency and document the new runtime configuration.

- [X] T001 [P] Add `pg` to `dependencies` and `@types/pg` to `devDependencies` in `product-service/package.json`, then run `npm install` in `product-service/` to regenerate `product-service/package-lock.json`.
- [X] T002 [P] Add `pg` to `dependencies` and `@types/pg` to `devDependencies` in `payment-service/package.json`, then run `npm install` in `payment-service/` to regenerate `payment-service/package-lock.json`.
- [X] T003 [P] Document the database configuration in `.env.example`: add `POSTGRES_USER=ecommerce`, a clearly non-secret `POSTGRES_PASSWORD` placeholder, `POSTGRES_DB=postgres`, and comments showing `PGHOST=database`, `PGPORT=5432`, and `PGDATABASE=products` / `payments` are supplied per service by Compose; keep `.env` ignored.

**Checkpoint**: Dependencies install locally and the required variables are documented.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Stand up the database container, create the logical databases, and initialize each service's schema before any HTTP traffic.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 [P] Create `database/init/01-create-databases.sh` to create the `products` and `payments` logical databases owned by `POSTGRES_USER` only when absent, using `psql -v ON_ERROR_STOP=1` and an existence check; make it executable, idempotent, and fail the container visibly on error. Do not create application tables here.
- [X] T005 Add the `database` service to `docker-compose.yml`: `image: postgres:17-alpine`, `${POSTGRES_USER:-ecommerce}`, required `${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}`, `${POSTGRES_DB:-postgres}`, mount `ecommerce_db_data:/var/lib/postgresql/data`, mount `./database/init:/docker-entrypoint-initdb.d:ro`, join the `ecommerce` network, publish **no** host port, set `restart: unless-stopped`, add a `pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"` health check (interval 10s, timeout 5s, retries 5, start period 20s), declare the `ecommerce_db_data` volume, and add `depends_on: database: condition: service_healthy` plus the `PG*` environment values to `product-service` and `payment-service`, preserving the existing `payment-service` → `product-service` dependency.
- [X] T006 [P] Create `product-service/src/db.ts`: a `pg.Pool` built from `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`; bounded connection retry with exponential backoff (max ~30s) and a clear error naming the database; export `query`, `initDb`, and `closePool`. `initDb` must run idempotent DDL from `contracts/data-schema.md`: `id uuid PRIMARY KEY`, `name text NOT NULL`, `description text NOT NULL`, `price numeric(12,2) NOT NULL CHECK (price > 0)`, `stock_quantity integer NOT NULL CHECK (stock_quantity >= 0)`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`, and `CREATE INDEX IF NOT EXISTS products_created_at_idx ON products (created_at, id)`. Never log credentials.
- [X] T007 [P] Create `payment-service/src/db.ts`: the same pool/retry/export contract, plus idempotent DDL from `contracts/data-schema.md`: `id uuid PRIMARY KEY`, `amount numeric(12,2) NOT NULL CHECK (amount > 0)`, `currency varchar(3) NOT NULL DEFAULT 'USD'`, `status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','cancelled'))`, `payment_method text NOT NULL`, `product_id text NOT NULL`, nullable `order_reference text`, `customer_info jsonb`, `card_last4 varchar(4)`, `card_brand text`, `created_at timestamptz NOT NULL DEFAULT now()`, nullable `processed_at timestamptz`, nullable `error_message text`, plus indexes on `(created_at, id)` and `(product_id)`. Never log credentials.
- [X] T008 Refactor `product-service/src/app.ts` to an async bootstrap: call `initDb()` before `app.listen()`, exit non-zero with a clear database-identifying log on failure, and `await closePool()` before `process.exit()` during existing graceful shutdown after `server.close()`. Keep `GET /health`, routes, 404 handler, signals, and shutdown timeout unchanged.
- [X] T009 Refactor `payment-service/src/app.ts` with the same async bootstrap, pool close, and existing health/routes/shutdown behavior.

**Checkpoint**: `docker compose up --build -d --wait` brings up four healthy containers; both schemas exist; both services start only after the database is reachable. API behavior is still the previous in-memory behavior until US1.

---

## Phase 3: User Story 1 — Data Survives Restarts (Priority: P1) 🎯 MVP

**Goal**: Persist products and payments in PostgreSQL so records survive container restarts, stop/start, `docker compose down`, and a database-only restart.

**Independent Test**: Create a product and a completed payment, run three restart cycles (restart, stop/start, down/up), then restart the database only; verify the same IDs, values, status, and timestamps on every read.

### Implementation for User Story 1

- [X] T010 [P] [US1] Replace the in-memory `Map` in `product-service/src/store.ts` with an async PostgreSQL repository exported as `productStore`: `getAll` (`ORDER BY created_at ASC, id ASC`), `getById`, `create` (UUID v4; `now()` timestamps), `update` (partial fields; `updated_at = now()`), `delete`, `updateStock`, `decreaseStock` using `UPDATE ... SET stock_quantity = stock_quantity - $2 ... WHERE id = $1 AND stock_quantity >= $2 RETURNING *`, and `incrementStock` using `UPDATE ... SET stock_quantity = stock_quantity + $2 ... WHERE id = $1 RETURNING *`. Return `undefined` when no row is returned; map `price` with `Number(...)` and timestamps with `.toISOString()`. Use only parameterized SQL.
- [X] T011 [US1] Update `product-service/src/controllers/productController.ts` to `await` every `productStore` call, with explicit `try/catch` and `return` on every response. Preserve all status codes, messages, and payload shapes for create/list/read/update/delete and the existing `stockQuantity`/`decrease` stock behavior. Do not add the `increment` field yet.
- [X] T012 [P] [US1] Replace the in-memory `Map` in `payment-service/src/store.ts` with an async PostgreSQL repository exported as `paymentStore`: `getAll` (`ORDER BY created_at ASC, id ASC`), `getById`, `create` (UUID v4; `status = 'pending'`; `currency` default `USD`; store only `card_last4` and `card_brand`; store `customer_info` as JSONB), and `updateStatus` guarded by `WHERE id = $1 AND status = 'pending'`, returning `undefined` when no pending row is updated. Map `amount` with `Number(...)`, timestamps with `.toISOString()`, and omit null optional fields in the returned API object. Never store the full card number, expiry, or CVV.
- [X] T013 [US1] Update `payment-service/src/controllers/paymentController.ts` to `await` repository calls for create/get/list and for status updates inside the existing async mock-processing callback. Keep the current card rules (`4111*` succeeds, `4000*` declines, others ~90% succeed), the ~100 ms delay, the `pending` 201 response, and the existing validation/404/422/503 pre-checks. Persistence must survive restart even though the saga ordering is refined in US2.
- [X] T014 [US1] Create `scripts/persistence-test.sh`: require `curl` and `jq`; create a product and a successful payment; poll until `completed`; run cycle 1 `docker compose restart`, cycle 2 `docker compose stop` + `start`, cycle 3 `docker compose down` + `up -d --wait` (never `-v`); wait for all services healthy after each cycle; then restart only the `database` service and wait for `product-service`/`payment-service` to recover; after each cycle and after the database-only restart assert the product ID/name/price/stock and payment ID/status/amount/card summary are identical; print `PASS` per cycle and exit non-zero on the first mismatch.
- [X] T015 [US1] Run `bash scripts/persistence-test.sh` against the running stack and fix any persistence or reconnection defects in `product-service/src/store.ts`, `payment-service/src/store.ts`, their controllers, or their `db.ts` files until all cycles pass.

**Checkpoint**: Products and payments survive all restart cycles, including a database-only restart. This is the persistence MVP increment.

---

## Phase 4: User Story 2 — Existing API Behavior Is Preserved (Priority: P1)

**Goal**: Keep every product/payment route, payload, status code, error shape, stock behavior, and the explicit `503` path unchanged while enforcing stock/payment consistency under concurrency.

**Independent Test**: Run `bash scripts/smoke-test.sh` (all 11 checks pass) and `bash scripts/concurrency-test.sh` (stock 10, 20 purchases, exactly 10 completed, stock ends at 0). Stop the product service and confirm payment creation returns `503` with no stock change.

### Implementation for User Story 2

- [X] T016 [P] [US2] Extend `PATCH /products/:id/stock` in `product-service/src/controllers/productController.ts` to accept exactly one of `stockQuantity`, `decrease`, or `increment`: require `Number.isInteger(...)` for `stockQuantity`/`decrease`/`increment`, reject none with `400` and the message `stockQuantity, decrease, or increment must be provided`, return `422` + `Insufficient stock or product not found` for an insufficient/missing `decrease`, and return `404` + `Product not found` for a missing `stockQuantity`/`increment`. Return `200` with the updated product and do not change any other route.
- [X] T017 [P] [US2] Implement the decrement-first saga in `payment-service/src/controllers/paymentController.ts`: keep the pre-flight product GET and its `404`/`503` behavior; persist the payment as `pending`; for a successful mock card, call the atomic decrement once (do not blindly retry an ambiguous mutation); on decrement success mark the payment `completed`; on decrement failure (insufficient stock or unavailable) mark it `failed` with an explanatory `errorMessage`; if the completion write fails after a successful decrement, best-effort call `PATCH /products/:id/stock` with `{ "increment": 1 }` and log the compensation. Never report `completed` without a persisted decrement.
- [X] T018 [P] [US2] Add database-unavailable mapping for the product service: add an `isDbUnavailableError` helper in `product-service/src/db.ts` (connection refused/reset, pool timeout, shutdown, `08xxx`/`57P01` classes) and use it in `product-service/src/controllers/productController.ts` to return `503 { "error": "Service Unavailable", "message": "..." }`; keep validation `400`, missing `404`, and insufficient stock `422` unchanged, and never include credentials in the message or log.
- [X] T019 [P] [US2] Add the same database-unavailable mapping to `payment-service/src/db.ts` and `payment-service/src/controllers/paymentController.ts`; distinguish payment-DB unavailability from product-service unavailability while preserving the existing `503` error shape and the no-stock-change guarantee on validation failure.
- [X] T020 [US2] Create `scripts/concurrency-test.sh`: create a product with `stockQuantity: 10`, fire 20 concurrent `POST /api/payments` requests with the success card, wait for all payments to settle, and assert final stock is `0` (never negative), exactly `10` payments are `completed`, every other request produced a `failed` payment or a `422`, and no payment contradicts stock. Print `PASS`/`FAIL` and exit non-zero on violation.
- [X] T021 [US2] Run `bash scripts/smoke-test.sh`, `bash scripts/concurrency-test.sh`, and a manual `503` check against the running stack; fix contract, mapping, stock, or consistency regressions in `product-service/src/store.ts`, `product-service/src/controllers/productController.ts`, `payment-service/src/store.ts`, or `payment-service/src/controllers/paymentController.ts` until all checks pass.

**Checkpoint**: Existing API contract is preserved, overselling is impossible under concurrency, and database/product-service failures return the correct `503`.

---

## Phase 5: User Story 3 — Isolated Database Service (Priority: P2)

**Goal**: Prove the database is its own container on the private network, reachable by the services, and unreachable from the host.

**Independent Test**: `docker compose ps` shows `database` healthy; `bash scripts/verify-isolation.sh` passes while asserting host access to `:3001`, `:3002`, and `:5432` is refused; a payment through the gateway still proves internal service-to-service and service-to-database connectivity.

### Implementation for User Story 3

- [X] T022 [P] [US3] Extend `scripts/verify-isolation.sh` to assert host access to port `5432` is refused, in addition to the existing `3001`/`3002` checks, and to fail if any `ports:` mapping for the database is found in `docker-compose.yml`. Keep the existing gateway health, internal payment, stock decrement, and cleanup checks unchanged.
- [X] T023 [US3] Run `bash scripts/verify-isolation.sh` and `docker compose ps`; confirm the `database` container is separate and healthy, `5432` is not published, and services use `PGHOST=database` rather than a hardcoded host address. Fix `docker-compose.yml`, the health check, or the isolation script as needed.

**Checkpoint**: Database isolation is demonstrably enforced and health-gated.

---

## Phase 6: User Story 4 — Controlled Reset and Fresh Start (Priority: P3)

**Goal**: Provide one documented, explicit reset that removes persisted data, restarts the stack, and verifies empty collections; ordinary restarts must never reset data.

**Independent Test**: Populate products/payments, run the reset script without confirmation (no change), run it with `--yes` (empty collections), then restart normally and confirm the data remains empty only because the reset removed it and schema initialization did not duplicate or error.

### Implementation for User Story 4

- [X] T024 [US4] Create `scripts/reset-data.sh`: without `--yes`, print exactly what will be destroyed and exit non-zero without changing anything; with `--yes`, run `docker compose down -v`, then `docker compose up --build -d --wait`, wait for gateway health, assert `GET /api/products` and `GET /api/payments` both return `[]`, and exit non-zero on failure. Document in the script header that `down -v` is destructive and that ordinary `down` preserves data.
- [X] T025 [US4] Run reset validation against the running stack: populate a product and payment, confirm `bash scripts/reset-data.sh` changes nothing, run `bash scripts/reset-data.sh --yes`, confirm both collections are empty, restart the stack normally, and confirm the schema re-initializes cleanly with no duplicates or startup errors. Fix `scripts/reset-data.sh` or the initialization path as needed.

**Checkpoint**: Reset is explicit, guarded, verified, and distinct from ordinary restart behavior.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, security, build hygiene, and full end-to-end validation across all stories.

- [X] T026 Update `README.md`: list the `database` container in the architecture; replace the in-memory no-persistence caveat with named-volume persistence semantics; document `POSTGRES_*`/`PG*` configuration and `.env` setup; document automatic schema initialization, `down` vs `down -v`, `scripts/reset-data.sh`, backup limitations, `docker compose logs database`, isolation, and troubleshooting for credentials, volume loss, unhealthy database, and `503`.
- [X] T027 [P] Reconcile `specs/003-containerized-database/quickstart.md` with the implemented scripts, flags, expected outputs, and container names; correct any drift and keep links to `data-model.md` and the contracts valid.
- [X] T028 [P] Audit credential handling: run `docker compose config` and inspect `.env.example`, `docker-compose.yml`, `product-service/Dockerfile`, `payment-service/Dockerfile`, and `docker compose logs` to confirm no real password is committed, baked into an image, or printed; confirm `.gitignore` still ignores `.env`.
- [X] T029 [P] Audit build/runtime hygiene: run `docker compose build --no-cache`; verify `pg` is installed in both runtime images with `docker compose run --rm --no-deps product-service npm ls pg` and `docker compose run --rm --no-deps payment-service npm ls pg`; verify dev dependencies are absent (for example `npm ls typescript` returns empty/non-zero); verify both runtime containers still run as the non-root `node` user; and confirm `product-service/package-lock.json` and `payment-service/package-lock.json` are tracked and updated.
- [X] T030 Clean up `product-service/src/store.ts`, `product-service/src/controllers/productController.ts`, `payment-service/src/store.ts`, and `payment-service/src/controllers/paymentController.ts`: remove dead in-memory code/imports, confirm no unused `uuid`/`Map` paths remain, and review the final diff to confirm no route paths, response fields, or status codes changed.
- [X] T031 Run the full validation sequence in this order: `bash scripts/smoke-test.sh`, `bash scripts/verify-isolation.sh`, `bash scripts/persistence-test.sh`, `bash scripts/concurrency-test.sh`, `bash scripts/reset-data.sh --yes`, then `bash scripts/smoke-test.sh` again. Leave the stack healthy at `http://localhost:8080` with empty collections, and record any remaining limitation in `README.md`.

**Checkpoint**: Documentation, security, build, and all acceptance checks pass; the stack is ready for delivery.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; T001–T003 can run in parallel.
- **Foundational (Phase 2)**: Depends on Setup. T005 depends on T004; T008 depends on T006; T009 depends on T007. T006/T007 can run in parallel with T004/T005.
- **User Story 1 (Phase 3)**: Depends on Foundational. Core persistence for both services.
- **User Story 2 (Phase 4)**: Depends on US1 because it refines the same store/controller code paths.
- **User Story 3 (Phase 5)**: Depends on Foundational (T005). It can run in parallel with US1/US2 because it edits only the isolation script/runtime checks.
- **User Story 4 (Phase 6)**: The script can be written after Foundational, but its independent test requires US1 persistence to be meaningful; plan to run T025 after US1.
- **Polish (Phase 7)**: Depends on all desired user stories. T026 updates `README.md` and must run after any earlier docs edits; T027–T029 can run in parallel; T030 then T031 last.

### User Story Dependencies

| Story | Priority | Depends on | Reason |
|-------|----------|------------|--------|
| US1 — Data survives restarts | P1 | Foundational | Needs the database container, logical DBs, and service `db.ts` initialization |
| US2 — API behavior preserved | P1 | US1 | Refines the DB-backed stores and controllers; also adds the stock increment and saga |
| US3 — Isolated database | P2 | Foundational | Validates the container/network/health configuration |
| US4 — Controlled reset | P3 | Foundational + US1 | Reset semantics are only observable with persistent data |

### Within Each User Story

- Repository/store changes before controllers.
- Controllers before scripts.
- Scripts before their validation runs.
- Fix regressions in the owning service before moving to the next story.

---

## Parallel Opportunities

### Setup

```bash
# T001 and T002 touch different services; T003 touches only .env.example.
Task: "T001 Add pg to product-service/package.json"
Task: "T002 Add pg to payment-service/package.json"
Task: "T003 Document POSTGRES_* in .env.example"
```

### Foundational

```bash
# Independent files:
Task: "T004 Create database/init/01-create-databases.sh"
Task: "T006 Create product-service/src/db.ts"
Task: "T007 Create payment-service/src/db.ts"

# After the two db.ts files exist:
Task: "T008 Refactor product-service/src/app.ts bootstrap"
Task: "T009 Refactor payment-service/src/app.ts bootstrap"
```

### User Story 1

```bash
# Product and payment repositories are independent:
Task: "T010 Replace product-service/src/store.ts"
Task: "T012 Replace payment-service/src/store.ts"

# Then their controllers:
Task: "T011 Update product-service/src/controllers/productController.ts"
Task: "T013 Update payment-service/src/controllers/paymentController.ts"
```

### User Story 2

```bash
# Product increment endpoint and payment saga are independent:
Task: "T016 Add increment support to product-service/src/controllers/productController.ts"
Task: "T017 Implement the decrement-first saga in payment-service/src/controllers/paymentController.ts"

# Then DB-error mapping per service:
Task: "T018 Add 503 mapping in product-service"
Task: "T019 Add 503 mapping in payment-service"
```

### Polish

```bash
Task: "T027 Reconcile specs/003-containerized-database/quickstart.md"
Task: "T028 Audit credential handling"
Task: "T029 Audit build/runtime hygiene"
```

---

## Parallel Example: User Story 1

```bash
# Launch the two repository rewrites together:
Task: "T010 Replace product-service/src/store.ts with a PostgreSQL repository"
Task: "T012 Replace payment-service/src/store.ts with a PostgreSQL repository"

# Once both complete, launch the controller updates together:
Task: "T011 Await productStore calls in productController.ts"
Task: "T013 Await paymentStore calls in paymentController.ts"
```

---

## Implementation Strategy

### MVP First (Persistence Increment)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (database container + schemas + startup gating).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run `bash scripts/persistence-test.sh`; confirm all three restart cycles and the database-only restart preserve data.
5. This is the persistence MVP: data survives restarts.

### Full P1 Release

1. Complete Setup + Foundational + US1.
2. Complete US2 (increment endpoint, saga, `503` mapping, concurrency test).
3. **VALIDATE**: `bash scripts/smoke-test.sh` and `bash scripts/concurrency-test.sh`.
4. This satisfies both P1 stories: persistence and unchanged API/consistency.

### Incremental Delivery

1. Foundation + US1 → persistent records.
2. US2 → contract parity, atomic stock behavior, oversell prevention.
3. US3 → isolation/health proof.
4. US4 → guarded reset.
5. Polish → docs, security, build audit, full suite.

### Parallel Team Strategy

- One developer completes Setup + Foundational.
- After Foundational:
  - Developer A: US1 then US2 (shared store/controller code).
  - Developer B: US3 isolation validation.
  - Developer C: US4 reset script (run its validation after US1 lands).
- Rejoin for Polish and full validation.

---

## Notes

- `scripts/smoke-test.sh` is intentionally **not modified**; it is the API-parity oracle.
- No unit-test framework is introduced; validation is script- and health-check-based as planned.
- No seed/demo data and no migration of pre-feature in-memory data.
- `docker compose down -v` is destructive; ordinary `down` and `restart` preserve the named volume.
- Do not commit `.env`; only `.env.example` is committed.
- Commit after each task or logical group, and stop at each checkpoint to validate the story independently.
