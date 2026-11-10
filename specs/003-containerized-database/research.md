# Phase 0 Research: Persistent Database Service in a Separate Container

**Feature**: `003-containerized-database`
**Date**: 2026-11-10
**Status**: Complete — all technical unknowns resolved

## Decision 1 — Database engine and version

**Decision**: PostgreSQL 17, running as `postgres:17-alpine`.

**Rationale**: The product and payment models are relational, benefit from constraints (`stock_quantity >= 0`, valid payment status), and need transactional updates for stock. PostgreSQL offers strong constraint support, JSONB for customer data, and a small official Alpine image. Version 17 is mature and supported, with predictable behavior and broad image availability.

**Alternatives considered**:
- SQLite: rejected — file locking and container-volume semantics are workable but weaker for concurrent writes and less representative of a network database.
- MongoDB: rejected — no need for a document store; existing entities are structured and relational.
- MySQL/MariaDB: viable, but PostgreSQL has better numeric and constraint ergonomics for this use case.
- PostgreSQL 18: valid, but 17 is sufficient and avoids adopting a newer major release without a concrete benefit.

## Decision 2 — One database container, separate logical databases

**Decision**: Run one database container containing two logical databases: `products` and `payments`.

**Rationale**: The user requested a single database running in another Docker container. Separate logical databases preserve service ownership (FR-015) without the operational overhead of two database instances. The product service cannot query payment tables and vice versa because they are in different databases with different connection targets.

**Alternatives considered**:
- Two database containers: rejected — doubles operational overhead and resource use for no benefit at this scale.
- Single database with two schemas: viable, but separate databases give a clearer ownership boundary and simpler connection configuration.
- Single database with shared tables: rejected — weakens service ownership and risks coupling.

## Decision 3 — Data access library

**Decision**: Use `pg` (node-postgres) with a connection pool and parameterized SQL. No ORM.

**Rationale**: The schema is small (two tables), queries are simple, and the existing codebase has no ORM. `pg` adds minimal weight, supports transactions, and avoids schema-generation and migration tooling that would dominate this feature. Parameterized queries prevent SQL injection.

**Alternatives considered**:
- Prisma: rejected — brings a schema language, generated client, and migration workflow disproportionate to two tables.
- TypeORM/Sequelize: rejected — decorators/entities and behavior hidden behind an ORM add complexity and bundle size.
- Raw `pg` with query builders (Kysely): viable, but unnecessary for this query volume.

## Decision 4 — Schema initialization strategy

**Decision**: Each service executes idempotent `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements at startup, after the database is reachable, before accepting traffic.

**Rationale**: Meets FR-005/FR-006 with no manual SQL and no separate migration step. Safe on repeated starts and on an existing volume. The schema is small enough that a migration framework adds no value.

**Alternatives considered**:
- SQL init scripts mounted into the PostgreSQL image: viable, but they only run on first volume creation and split schema knowledge away from the owning service.
- Migration framework (node-pg-migrate, Flyway): rejected — operational overhead and new tooling for one initial schema.
- Manual init: rejected — violates the no-manual-steps requirement.

## Decision 5 — Persistence mechanism

**Decision**: Named Docker volume `ecommerce_db_data` mounted at the PostgreSQL data directory.

**Rationale**: Named volumes survive container recreation and `docker compose down`, are portable across hosts, and are removed explicitly with `down -v`. This matches the spec's persistence and reset semantics.

**Alternatives considered**:
- Bind mount to a host directory: viable, but introduces host-path coupling and permission issues.
- Anonymous volume: rejected — harder to identify and reset deliberately.
- No volume: rejected — defeats the feature.

## Decision 6 — Credential and connection configuration

**Decision**: Require `POSTGRES_PASSWORD` from a gitignored `.env`; Compose uses required-variable syntax so missing values fail fast. Services receive `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE` individually.

**Rationale**: Standard `pg` environment variables avoid embedding passwords in URLs (which can leak in logs and require URL encoding). No secrets are baked into images or committed. A documented `.env.example` makes setup explicit.

**Alternatives considered**:
- `DATABASE_URL` connection string: viable, but password encoding and accidental logging are more likely.
- Hardcoded development password in Compose: rejected — committed credential, violates FR-009.
- Docker secrets: rejected — targets Swarm and is disproportionate for local Compose.

## Decision 7 — Database readiness and startup ordering

**Decision**: Database health check uses `pg_isready -U "$POSTGRES_USER" -d postgres`. Both application services declare `depends_on` with `condition: service_healthy` on the database. Services also retry connection with bounded backoff as defense in depth.

**Rationale**: Health-gated startup prevents connection storms and crash loops. A small retry window handles the gap between `pg_isready` success and the init script finishing. `pg_isready` is built into the official image.

**Alternatives considered**:
- Sleep loops: rejected — fragile and slow.
- No health check with plain `depends_on`: rejected — waits only for container start.
- Application-only retry: viable, but produces noisy logs and slower readiness.

## Decision 8 — Atomic stock and payment consistency

**Decision**: Use an atomic conditional update for stock decrement:
`UPDATE products SET stock_quantity = stock_quantity - 1 WHERE id = $1 AND stock_quantity > 0 RETURNING ...`.
The payment flow decrements stock first, marks the payment `completed` only on success, marks it `failed` on decrement failure, and attempts a compensating atomic increment if the completion update fails after a successful decrement. Add an optional `increment` field to the existing stock PATCH endpoint.

**Rationale**: A conditional UPDATE is atomic under PostgreSQL concurrency and prevents overselling without explicit locking. Decrement-before-complete satisfies FR-012. Compensation handles the narrow failure window where the payment database write fails after stock changed, approximating a saga without introducing two-phase commit.

**Alternatives considered**:
- Read-modify-write in application code: rejected — race condition allows overselling.
- `SELECT ... FOR UPDATE` then update: viable, but more round trips and lock management for no gain.
- Two-phase commit across services: rejected — the services use separate databases and distributed transactions are disproportionate.
- Shared transaction across both databases: rejected — would require a single database and couples services.
- Keep mark-completed-then-decrement: rejected — can report completed payments with unchanged stock.

## Decision 9 — Numeric and JSON mapping

**Decision**: Store money as `numeric(12,2)` and convert to JavaScript numbers when mapping rows to API responses. Store customer information as `jsonb`. Map card data to `card_last4`/`card_brand` columns and reconstruct the existing `cardDetails` object.

**Rationale**: Preserves the existing JSON contract exactly (numbers, nested objects) while keeping database precision. Two decimal places match the domain.

**Alternatives considered**:
- Store money as floating point: rejected — rounding errors.
- Return numeric strings: rejected — breaks the API contract.
- Store card summary as JSONB: viable, but explicit columns keep sensitive summary data narrow and queryable.

## Decision 10 — Reset procedure

**Decision**: Document `docker compose down -v` as the destructive reset and add `scripts/reset-data.sh` requiring an explicit `--yes` flag to perform it, restart the stack, and verify empty collections.

**Rationale**: Ordinary `down` must preserve data (FR-018 vs. SC-001), so reset requires explicit volume removal. A guarded script prevents accidental data loss while giving testers a one-command reset.

**Alternatives considered**:
- SQL truncate via an endpoint: rejected — expands the public API and security surface.
- Automatic reset on every start: rejected — violates persistence.
- `down -v` documentation only: viable; the script adds safety and verification.

## Decision 11 — Validation strategy

**Decision**:
- Reuse `scripts/smoke-test.sh` unchanged to prove API parity.
- Extend `scripts/verify-isolation.sh` to assert host access to port 5432 is refused.
- Add `scripts/persistence-test.sh` to create a product and completed payment, restart the stack three times, and verify identical records.
- Add `scripts/concurrency-test.sh` to create stock 10, fire 20 concurrent payments, and assert exactly 10 complete, 10 fail, and stock ends at 0.
- Add `scripts/reset-data.sh` for the explicit reset path.

**Rationale**: Each success criterion with a runtime component (SC-001, SC-006, SC-008, SC-009) gets a deterministic, repeatable check using curl and Docker Compose. No test framework is introduced.

**Alternatives considered**:
- Jest + Supertest: viable long term, but out of scope and would require broad test infrastructure.
- Manual verification only: rejected — persistence and concurrency are easy to mis-verify.
- Database-level SQL tests: insufficient — they would not prove the public API contract.

## Resolved Unknowns

| Item | Resolution |
|------|------------|
| Database engine | PostgreSQL 17 (`postgres:17-alpine`) |
| Instance topology | One container, two logical databases (`products`, `payments`) |
| Access layer | `pg` pool + parameterized SQL, no ORM |
| Schema creation | Idempotent DDL at service startup |
| Persistence | Named volume `ecommerce_db_data` |
| Credentials | Required `.env` variables; `PG*` env vars in services; never baked |
| Readiness | `pg_isready` health check + health-gated `depends_on` + bounded retry |
| Oversell prevention | Atomic conditional `UPDATE ... WHERE stock_quantity > 0` |
| Payment consistency | Decrement-first saga with compensation |
| Reset | `docker compose down -v` via guarded `scripts/reset-data.sh` |
| API contract | Unchanged; verified by existing smoke test |
| Migration of old data | None; first persistent start is empty |
