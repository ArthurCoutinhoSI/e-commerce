# Implementation Plan: Persistent Database Service in a Separate Container

**Branch**: `003-containerized-database` | **Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-containerized-database/spec.md`

## Summary

Add a dedicated PostgreSQL container to the existing Compose stack and replace both in-memory `Map` stores with database-backed repositories. Products and payments survive restarts through a named volume. Each service owns a separate logical database (`products`, `payments`) and initializes its schema idempotently at startup. The database is internal-only, health-gated, and configured through environment variables. A saga-style payment flow performs an atomic conditional stock decrement before marking a payment completed, preserving the existing API contract while preventing overselling and completed-without-stock states.

## Technical Context

**Language/Version**: TypeScript 5.2 compiled to CommonJS ES2020; Node.js 22 LTS runtime containers (unchanged).

**Primary Dependencies**: Existing Express 4.18, `http-proxy-middleware` 2.0.6, `axios` 1.6, `uuid` 9, `cors` 2.8. **New**: `pg` 8.x (PostgreSQL driver) and `@types/pg` (dev). Database engine: PostgreSQL 17 on `postgres:17-alpine`.

**Storage**: PostgreSQL 17 container with a named volume (`ecommerce_db_data`). Separate logical databases: `products` (product service) and `payments` (payment service). No ORM; hand-written SQL with parameterized queries. No migration framework; idempotent `CREATE TABLE IF NOT EXISTS` at service startup.

**Testing**: No unit test framework exists. Validation uses health checks plus shell scripts: existing `scripts/smoke-test.sh` and `scripts/verify-isolation.sh`, new `scripts/persistence-test.sh` (3 restart cycles), `scripts/concurrency-test.sh` (20 concurrent purchases), and `scripts/reset-data.sh` (explicit wipe + restart).

**Target Platform**: Linux host with Docker Engine 24+ and Compose v2+; PostgreSQL `17-alpine` (amd64/arm64). Host database port not published.

**Project Type**: Multi-service web backend (API gateway, product service, payment service, database).

**Performance Goals**: Full stack including database serving within 90 seconds; persistence checks completed within 30 seconds; 20 concurrent purchase attempts evaluated within 30 seconds; database restart recovery within 60 seconds.

**Constraints**: No host-published database port; credentials required from `.env` and never baked into images or logged; separate logical databases per service; atomic stock decrement; existing API contract unchanged; no migration of pre-existing in-memory data; ordinary restarts must never clear data.

**Scale/Scope**: Four containers (gateway, product, payment, database), one database instance, two logical databases, local developer workstation. No replication, HA, backups, cloud database, or multi-replica coordination.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unratified scaffold containing placeholders only; it declares no enforceable principles, constraints, or governance rules.

- **Gate result**: PASS (no ratified principles to violate).
- **Post-Phase 1 re-check**: PASS — design artifacts are complete and consistent:
  - [data-model.md](./data-model.md) adds durable Product/Payment entities and runtime entities without changing the public JSON contract.
  - [contracts/database-runtime.md](./contracts/database-runtime.md) keeps the database internal-only, health-gated, credential-driven, and reset-explicit.
  - [contracts/data-schema.md](./contracts/data-schema.md) preserves service ownership through separate logical databases and enforces stock/status invariants in SQL.
  - [quickstart.md](./quickstart.md) validates persistence, API parity, isolation, concurrency, and reset without manual database steps.
  - No cloud, HA, backup, authentication, or public-database scope was introduced.

## Project Structure

### Documentation (this feature)

```text
specs/003-containerized-database/
├── plan.md              # This file
├── research.md          # Phase 0 decisions
├── data-model.md        # Persistent schema and runtime entities
├── quickstart.md        # Validation guide (persistence, reset, concurrency)
├── contracts/
│   ├── database-runtime.md  # Database container/operator contract
│   └── data-schema.md       # Tables, ownership, constraints
└── tasks.md             # Phase 2 output (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
e-commerce/
├── docker-compose.yml                 # MODIFIED: add database service + volume + health gating
├── .env.example                       # MODIFIED: add POSTGRES_* and per-service DB settings
├── .gitignore                         # already ignores .env and dist
├── database/
│   └── init/
│       └── 01-create-databases.sh     # NEW: create products/payments databases on first init
├── api-gateway/
│   ├── src/app.ts                     # unchanged (except existing behavior)
│   └── Dockerfile                     # unchanged
├── product-service/
│   ├── package.json                   # MODIFIED: add pg + @types/pg
│   ├── package-lock.json              # MODIFIED
│   ├── Dockerfile                     # unchanged (copies package files)
│   └── src/
│       ├── db.ts                      # NEW: pool, retry connect, idempotent schema init
│       ├── store.ts                   # REPLACED: async PostgreSQL repository
│       ├── controllers/productController.ts  # MODIFIED: async store calls, stock increment support
│       └── routes/products.ts         # unchanged
├── payment-service/
│   ├── package.json                   # MODIFIED: add pg + @types/pg
│   ├── package-lock.json              # MODIFIED
│   ├── Dockerfile                     # unchanged
│   └── src/
│       ├── db.ts                      # NEW: pool, retry connect, idempotent schema init
│       ├── store.ts                   # REPLACED: async PostgreSQL repository
│       └── controllers/paymentController.ts  # MODIFIED: DB-backed saga (decrement → complete → compensate)
├── scripts/
│   ├── smoke-test.sh                  # reused unchanged
│   ├── verify-isolation.sh            # MODIFIED: also assert database port 5432 is unreachable
│   ├── persistence-test.sh            # NEW: create data, 3 restart cycles, verify persistence
│   ├── concurrency-test.sh            # NEW: 20 concurrent purchases, assert no oversell
│   └── reset-data.sh                  # NEW: explicit confirmed data reset (down -v + up)
└── README.md                          # MODIFIED: persistence, credentials, reset, troubleshooting
```

**Structure Decision**: Add a single database container to the existing Compose stack rather than a separate Compose file or external managed database. Each service connects to its own logical database using standard PostgreSQL environment variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`), which avoids embedding credentials in connection URLs and keeps logs clean. Schema creation lives in each service (idempotent DDL) so that first start requires no manual SQL.

## Key Design Decisions

### Database and ownership
- One `postgres:17-alpine` container, named volume `ecommerce_db_data`.
- Init script creates `products` and `payments` databases owned by the configured user on first volume initialization.
- Product service connects only to `products`; payment service only to `payments`. Cross-service data access remains HTTP-only.

### Configuration and credentials
- `.env` (gitignored) supplies `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` support values.
- Compose uses required-variable syntax (`${POSTGRES_PASSWORD:?...}`) so startup fails clearly if the password is missing.
- Services receive `PGHOST=database`, `PGPORT=5432`, `PGUSER`, `PGPASSWORD`, `PGDATABASE=<products|payments>`.
- `.env.example` documents the required variables with placeholders; README instructs copying it to `.env`.

### Schema initialization
- Each service runs `CREATE TABLE IF NOT EXISTS` plus indexes on startup before accepting traffic.
- No seed data; a fresh database yields empty collections.
- Startup connects with bounded retry/backoff so a slow database does not crash the process permanently.

### Product persistence
- `products` table: UUID primary key, name, description, `numeric(12,2)` price, integer `stock_quantity >= 0`, timestamps.
- Stock decrement uses an atomic conditional update:
  `UPDATE products SET stock_quantity = stock_quantity - 1 WHERE id = $1 AND stock_quantity > 0 RETURNING ...`.
- Add an atomic increment operation (used for compensation) without changing existing endpoints; extend the stock PATCH body with an optional `increment` field and keep `decrease`/`stockQuantity` behavior.

### Payment persistence
- `payments` table: UUID primary key, `numeric(12,2)` amount, currency, status with check constraint, payment method, product reference, order reference, JSONB customer info, card last4/brand, timestamps, error message.
- Numeric columns are mapped to JS numbers in responses to preserve the existing JSON contract.
- Status transitions: `pending → completed | failed | cancelled`. Only `pending` may transition.

### Payment/stock consistency (saga)
1. Validate input and confirm the product exists/has stock via the product service.
2. Persist payment as `pending`.
3. Asynchronously call the product service atomic decrement.
4. On decrement success, update payment to `completed`.
5. On decrement failure (insufficient stock or unavailable), update payment to `failed` with a reason — never `completed`.
6. If the completion update fails after a successful decrement, best-effort call the atomic increment endpoint to compensate.
This preserves existing asynchronous behavior while enforcing FR-012/FR-013.

### Failure handling
- DB unavailable at startup: bounded retry, then clear fatal log; Compose keeps the container restarting.
- DB unavailable during a request: controllers return `503` with the existing error shape.
- Database health check uses `pg_isready`; application services gate on `service_healthy`.
- Database restart does not lose committed data; services reconnect through the pool.

### Reset and lifecycle
- Ordinary `docker compose down` preserves the named volume and therefore data.
- `docker compose down -v` removes the volume and all data.
- `scripts/reset-data.sh` documents and automates the destructive reset with an explicit confirmation flag.
- No migration from in-memory data; first persistent start is empty.

## Complexity Tracking

> No constitution gates exist, so there are no violations to justify.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
