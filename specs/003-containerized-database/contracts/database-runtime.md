# Contract: Database Runtime and Operator Interface

**Feature**: `003-containerized-database`
**Status**: New runtime interface
**Consumers**: stack operators, testers, and the product/payment services

This contract defines the database's place in the Compose stack, how services reach it, how its health and lifecycle are observed, and how data is preserved or destroyed. Application schema details are in [data-schema.md](./data-schema.md); entities are in [../data-model.md](../data-model.md).

## Stack Identity

| Property | Value |
|----------|-------|
| Compose project | `ecommerce` (explicit; unchanged) |
| Network | `ecommerce` (user-defined bridge, project-scoped) |
| Compose file | `docker-compose.yml` at repository root |
| Host prerequisite | Docker Engine 24+ with Compose v2+ |

## Services

| Compose service | Image | Internal port | Host port | Health check |
|-----------------|-------|---------------|-----------|--------------|
| `database` | `postgres:17-alpine` | `5432` | **none** | `pg_isready` |
| `api-gateway` | `ecommerce/api-gateway:local` | `8080` | `8080` | `GET /health` |
| `product-service` | `ecommerce/product-service:local` | `3001` | none | `GET /health` |
| `payment-service` | `ecommerce/payment-service:local` | `3002` | none | `GET /health` |

**Rules**

- The `database` service MUST NOT publish port `5432` to the host under the default configuration. (FR-007, SC-005)
- Only `api-gateway` publishes a host port.
- The database container MUST run on the same internal `ecommerce` network as the services.
- The database MUST use a named volume; it MUST NOT rely on container-local writable storage for data.
- The database container MUST use `restart: unless-stopped`. (FR-017)
- The database MUST NOT be given an application image or run application code; it is a stock PostgreSQL image.

## Database Service Definition (contractual shape)

| Setting | Required value |
|---------|----------------|
| Image | `postgres:17-alpine` |
| `POSTGRES_USER` | `${POSTGRES_USER:-ecommerce}` |
| `POSTGRES_PASSWORD` | `${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}` |
| `POSTGRES_DB` | `${POSTGRES_DB:-postgres}` |
| Volume | `ecommerce_db_data:/var/lib/postgresql/data` |
| Network | `ecommerce` |
| Published ports | none |
| Restart policy | `unless-stopped` |
| Init scripts | `./database/init:/docker-entrypoint-initdb.d:ro` |
| Health check | `pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"` |
| Health interval / timeout / retries / start period | `10s` / `5s` / `5` / `20s` |

The exact Compose syntax may vary, but these behaviors are mandatory. The password MUST use required-variable syntax so a missing `.env` value fails at `docker compose up` rather than starting a credential-less database.

## Logical Database Ownership

| Logical database | Owner service | Allowed access |
|------------------|---------------|----------------|
| `products` | `product-service` | Product rows only |
| `payments` | `payment-service` | Payment rows only |
| `postgres` | Database bootstrap/health | Connection checks and first-start init only |

- The init script creates `products` and `payments` owned by `POSTGRES_USER` on first volume initialization.
- The product service sets `PGDATABASE=products`; the payment service sets `PGDATABASE=payments`.
- Neither service MAY connect to the other's database. Cross-service access is HTTP only. (FR-015)

## Environment Contract

| Variable | Consumer(s) | Required | Default | Stack value |
|----------|-------------|----------|---------|-------------|
| `POSTGRES_USER` | database, product, payment | yes | `ecommerce` | same |
| `POSTGRES_PASSWORD` | database, product, payment | **yes** | none | supplied by `.env` |
| `POSTGRES_DB` | database | no | `postgres` | same |
| `PGHOST` | product, payment | yes | — | `database` |
| `PGPORT` | product, payment | yes | — | `5432` |
| `PGUSER` | product, payment | yes | — | `${POSTGRES_USER}` |
| `PGPASSWORD` | product, payment | yes | — | `${POSTGRES_PASSWORD}` |
| `PGDATABASE` | product | yes | — | `products` |
| `PGDATABASE` | payment | yes | — | `payments` |

- Credentials MUST NOT be committed, baked into images, or printed in logs. (FR-008, FR-009)
- `.env` is gitignored; `.env.example` documents every required variable with a placeholder.
- Changing configuration MUST NOT require rebuilding application images.
- Services MUST use standard `PG*` variables rather than embedding credentials in a connection URL.

## Health Check Contract

- Checker: `pg_isready` shipped in the official PostgreSQL image.
- Success: exit code `0` (server accepting connections on the bootstrap database).
- Timing: interval `10s`, timeout `5s`, retries `5`, start period `20s`.
- Healthy status MUST be visible through `docker compose ps`.
- The product and payment services MUST declare `depends_on: database: condition: service_healthy`. (FR-016)
- Services MUST also retry their initial connection with bounded backoff so a brief readiness race does not cause a crash loop. (FR-010)
- The API gateway MUST NOT be considered ready until both backend services are healthy.

## Startup Ordering Contract

```text
database (healthy)
   ├── product-service (healthy)
   └── payment-service (healthy)
          └── api-gateway (healthy, publishes :8080)
```

- `product-service` waits for `database` healthy.
- `payment-service` waits for `database` healthy **and** `product-service` healthy (existing behavior).
- `api-gateway` waits for both backends healthy (existing behavior).
- Startup MUST require no manual database commands. (FR-005, SC-003)

## Lifecycle Contract

| Operation | Command | Containers | Network | `ecommerce_db_data` | Data |
|-----------|---------|-----------|---------|---------------------|------|
| Build + start | `docker compose up --build -d` | created/started | created | created if absent | preserved |
| Status | `docker compose ps` | unchanged | unchanged | unchanged | preserved |
| Restart stack | `docker compose restart` | restarted | preserved | preserved | **preserved** |
| Stop | `docker compose stop` | stopped | preserved | preserved | **preserved** |
| Remove | `docker compose down` | removed | removed | **preserved** | **preserved** |
| Restart DB only | `docker compose restart database` | db restarted | preserved | preserved | **preserved** |
| Rebuild images | `docker compose build` | unchanged | unchanged | preserved | preserved |
| Explicit reset | `bash scripts/reset-data.sh --yes` | recreated | recreated | **removed then recreated** | **destroyed** |
| Manual destructive | `docker compose down -v` | removed | removed | **removed** | **destroyed** |

**Rules**

- Ordinary restarts and `down` MUST NOT clear data. (FR-002, FR-018, SC-001)
- Only explicit volume removal resets data.
- `down -v` is documented as destructive.
- On a missing volume, startup MUST initialize an empty schema automatically and document that prior data is gone.
- No in-memory data from previous versions is migrated; the first persistent start is empty. (FR-022)

## Reset Contract

`scripts/reset-data.sh`

| Invocation | Behavior |
|------------|----------|
| `bash scripts/reset-data.sh` | Prints what would be deleted, refuses to proceed, exits non-zero |
| `bash scripts/reset-data.sh --yes` | Runs `docker compose down -v`, runs `docker compose up --build -d`, waits for health, verifies empty collections |
| `bash scripts/reset-data.sh --yes --no-start` | Destroys data without restarting (optional convenience; if not implemented, the script may omit this flag) |

Exit criteria for `--yes`:

1. Stack healthy within 90 seconds.
2. `GET /api/products` returns `[]`.
3. `GET /api/payments` returns `[]`.
4. Script exits `0`.

The reset MUST NOT be triggered by any application startup path.

## Failure Contract

| Failure | Required behavior |
|---------|-------------------|
| `POSTGRES_PASSWORD` missing | `docker compose up` fails immediately and names the missing variable; no database starts |
| Database not ready at startup | Services wait via health-gated `depends_on`, then retry with bounded backoff |
| Database unreachable after retries | Process exits/logs a clear error naming the database; restart policy retries; no silent in-memory fallback |
| Database unavailable during a request | API returns the existing `503` error shape (FR-011) |
| Database crashes | `unless-stopped` restarts it; committed data remains; services reconnect via the pool |
| Database restarted independently | Services resume serving within 60 seconds; no data loss (SC-009) |
| Wrong credentials | Clear authentication error in logs; no credential value logged |
| Host try to reach `:5432` | Connection refused under default configuration (SC-005) |
| Disk/volume removed | Fresh empty schema; data loss is expected and documented |
| Init script runs twice | `CREATE ... IF NOT EXISTS` keeps it idempotent; no data loss or duplication (FR-006) |
| Concurrent stock purchases | Atomic conditional decrement prevents stock below zero (FR-013) |

## Observability Contract

| Need | Interface |
|------|-----------|
| Container/health status | `docker compose ps` — `database` must appear with a health state |
| Database logs | `docker compose logs database` |
| All logs | `docker compose logs -f` |
| Publication check | `bash scripts/verify-isolation.sh` — asserts `localhost:5432` refused |
| Persistence check | `bash scripts/persistence-test.sh` |
| Concurrency check | `bash scripts/concurrency-test.sh` |

Database logs MUST NOT contain the database password.

## Security and Scope Boundaries

**In scope**: separate container, named volume, private network, environment-based credentials, health gating, idempotent schema init, explicit reset.

**Out of scope**: TLS, authentication/authorization beyond PostgreSQL's own role, replication, high availability, failover, backups, point-in-time recovery, cloud/managed databases, host-published database port, data migration from the in-memory store.

## Acceptance Mapping

| Requirement | Contract evidence |
|-------------|-------------------|
| FR-001 | `database` is its own Compose service |
| FR-002 | Named volume in lifecycle table |
| FR-005 | Init script + service-side idempotent schema creation |
| FR-006 | Idempotent DDL; `down` preserves data |
| FR-007 / SC-005 | No published port; isolation script checks `5432` |
| FR-008 / FR-009 | Environment contract; `.env` gitignored |
| FR-010 / FR-016 | Health check + health-gated `depends_on` + retry |
| FR-017 | `restart: unless-stopped` |
| FR-018 / SC-008 | Reset contract |
| FR-019 / SC-010 | Observability contract |
