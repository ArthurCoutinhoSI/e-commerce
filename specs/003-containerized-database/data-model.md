# Data Model: Persistent Database Service in a Separate Container

**Feature**: `003-containerized-database`
**Date**: 2026-11-10
**Sources**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md)

This document defines the durable entities, their fields, constraints, mappings, and lifecycle. It describes *what* is stored and *how records must behave*; concrete DDL is in [contracts/data-schema.md](./contracts/data-schema.md).

## Entity Overview

| Entity | Kind | Owner | Persistence |
|--------|------|-------|-------------|
| **Persistent Product** | Stored record | Product service | `products` logical database, `products` table |
| **Persistent Payment** | Stored record | Payment service | `payments` logical database, `payments` table |
| **Database Service** | Runtime container | Stack operator | `database` Compose service |
| **Persistent Volume** | Storage boundary | Docker Engine | `ecommerce_db_data` named volume |
| **Database Credentials** | Runtime configuration | Stack operator | Gitignored `.env`, injected as environment variables |
| **Reset Procedure** | Operator operation | Stack operator | `scripts/reset-data.sh` + Compose volume removal |

**Ownership rule**: the product service connects only to the `products` database, and the payment service connects only to the `payments` database. There is no cross-database query. Payments reference products only by the `productId` value returned from the product service's HTTP API. No foreign key spans the two databases.

---

## Persistent Product

The durable form of the existing `Product` API object. The JSON contract is unchanged.

### Fields

| API field | Column | Type | Null | Default | Notes |
|-----------|--------|------|------|---------|-------|
| `id` | `id` | `uuid` | no | application-generated | Primary key; UUID v4 created by the service |
| `name` | `name` | `text` | no | — | Non-empty |
| `description` | `description` | `text` | no | — | Non-empty |
| `price` | `price` | `numeric(12,2)` | no | — | Must be `> 0`; returned as a JSON number |
| `stockQuantity` | `stock_quantity` | `integer` | no | — | Must be `>= 0`; never allowed below zero |
| `createdAt` | `created_at` | `timestamptz` | no | `now()` | Returned as ISO-8601 UTC string |
| `updatedAt` | `updated_at` | `timestamptz` | no | `now()` | Updated on every mutation; returned as ISO-8601 UTC string |

### Validation rules (must match the current API exactly)

| Operation | Rule | Failure |
|-----------|------|---------|
| Create | `name` present and non-empty string | `400` — `Name and description are required` |
| Create | `description` present and non-empty string | `400` — `Name and description are required` |
| Create | `price` is a number `> 0` | `400` — `Price must be a positive number` |
| Create | `stockQuantity` is an integer `>= 0` | `400` — `Stock quantity must be a non-negative number` |
| Update | If present, `price` is a number `> 0` | `400` — `Price must be a positive number` |
| Update | If present, `stockQuantity` is an integer `>= 0` | `400` — `Stock quantity must be a non-negative number` |
| Update | Product must exist | `404` — `Product not found` |
| Delete | Product must exist | `404` — `Product not found` |
| Stock adjust | Exactly one of `stockQuantity`, `decrease`, or `increment` must be provided | `400` — `stockQuantity, decrease, or increment must be provided` |
| Stock adjust | `decrease`/`increment` must be a positive integer | `400` — invalid stock adjustment |
| Stock adjust (decrease) | Product must exist and hold enough stock | `422` — `Insufficient stock or product not found` |
| Stock adjust (set) | Product must exist | `404` — `Product not found` |
| Stock adjust (increment) | Product must exist | `404` — `Product not found` |

Database-level constraints back the application rules so a logic bug cannot persist invalid data:

- `price > 0`
- `stock_quantity >= 0`
- Primary key on `id`

Money is stored with two decimal places (`numeric(12,2)`); inputs with more decimals are rounded by the database and responses return the stored value. Stock values are integers; fractional stock input is rejected with `400` before it reaches SQL.

### Atomic stock operations

Stock mutations must be safe under concurrency (FR-013, SC-006) and must never move stock below zero.

| Operation | Expected SQL semantics | Outcome |
|-----------|------------------------|---------|
| Decrement by 1 (payment) | `UPDATE products SET stock_quantity = stock_quantity - 1, updated_at = now() WHERE id = $1 AND stock_quantity > 0 RETURNING *` | Row returned → success; no row → not found or insufficient stock |
| Decrement by N (PATCH `decrease`) | `UPDATE ... SET stock_quantity = stock_quantity - $2 ... WHERE id = $1 AND stock_quantity >= $2 RETURNING *` | Row returned → success; no row → `422` |
| Increment by N (compensation / PATCH `increment`) | `UPDATE ... SET stock_quantity = stock_quantity + $2 ... WHERE id = $1 RETURNING *` | Row returned → success; no row → `404` |
| Set absolute value (PATCH `stockQuantity`) | `UPDATE ... SET stock_quantity = $2 ... WHERE id = $1 RETURNING *` | Row returned → success; no row → `404` |

No read-modify-write in application code; the conditional `UPDATE` is the concurrency control.

### Relationships

- One product may be referenced by zero or more payments through `payment.productId`.
- The reference is **logical, not enforced**. The payment service validates product existence over HTTP before creating a payment.

---

## Persistent Payment

The durable form of the existing `Payment` API object. The JSON contract is unchanged.

### Fields

| API field | Column | Type | Null | Default | Notes |
|-----------|--------|------|------|---------|-------|
| `id` | `id` | `uuid` | no | application-generated | Primary key; UUID v4 |
| `amount` | `amount` | `numeric(12,2)` | no | — | Must be `> 0`; returned as a JSON number |
| `currency` | `currency` | `varchar(3)` | no | `'USD'` | Defaults to `USD` when omitted, as today |
| `status` | `status` | `text` | no | `'pending'` | One of `pending`, `completed`, `failed`, `cancelled` |
| `paymentMethod` | `payment_method` | `text` | no | — | Required |
| `productId` | `product_id` | `text` | no | — | Required; logical reference to the product database |
| `orderReference` | `order_reference` | `text` | yes | `null` | Optional |
| `customerInfo` | `customer_info` | `jsonb` | yes | `null` | Stored as JSON and returned as the original object |
| `cardDetails.last4` | `card_last4` | `varchar(4)` | yes | `null` | Only the last four digits of the supplied card number |
| `cardDetails.brand` | `card_brand` | `text` | yes | `null` | `visa`, `mastercard`, or `unknown` |
| `createdAt` | `created_at` | `timestamptz` | no | `now()` | ISO-8601 UTC in responses |
| `processedAt` | `processed_at` | `timestamptz` | yes | `null` | Set when the payment reaches a terminal state |
| `errorMessage` | `error_message` | `text` | yes | `null` | Set for failed payments |

### Sensitive data rule

The full card number, expiry, and CVV are **never stored**. They are used only in memory to decide the mock outcome and to derive `card_last4` / `card_brand`. The database must not contain them.

Brand derivation (unchanged): first digit `4` → `visa`, first digit `5` → `mastercard`, otherwise `unknown`. `last4` is the final four characters of the card number.

### Validation rules (must match the current API exactly)

| Rule | Failure |
|------|---------|
| `amount` present and `> 0` | `400` — `Amount must be a positive number` |
| `paymentMethod` present | `400` — `Payment method is required` |
| `productId` present | `400` — `Product ID is required` |
| `cardDetails.number` present | `400` — `Card details are required` |
| Product must exist | `404` — `Product not found` |
| Product must have stock at validation time | `422` — `Insufficient stock` |
| Product service must be reachable at validation time | `503` — `Product service is unavailable` |

Database-level constraints:

- `amount > 0`
- `status IN ('pending', 'completed', 'failed', 'cancelled')`
- Primary key on `id`

### Payment status transitions

```text
                 ┌──────────────► completed
                 │                    │
pending ─────────┼──────────────► failed
                 │                    │
                 └──────────────► cancelled

Terminal states (completed, failed, cancelled) MUST NOT transition again.
```

| Transition | Trigger | Side effects |
|------------|---------|--------------|
| *(new)* → `pending` | `POST /api/payments` accepted | Row inserted with `created_at = now()`; `processed_at` and `error_message` are `null` |
| `pending` → `completed` | Mock card success **and** the atomic stock decrement succeeded | `processed_at = now()`; stock already decremented |
| `pending` → `failed` | Card declined, random mock failure, insufficient stock, or decrement failure | `processed_at = now()`; `error_message` set |
| `pending` → `cancelled` | Reserved for future use; no current endpoint sets it | `processed_at = now()` |

All transition writes must be guarded: `... WHERE id = $1 AND status = 'pending'`. A transition that finds no `pending` row must not overwrite the terminal state.

### Payment/stock consistency (saga invariants)

1. A payment MUST NOT be `completed` unless a corresponding successful stock decrement was persisted. (FR-012)
2. A payment that fails to decrement stock MUST end as `failed` with an explanatory `error_message`.
3. If the stock decrement succeeds but the subsequent `completed` write fails, the service MUST attempt a compensating atomic increment and log the failure. The payment must not be reported as completed when the completion write did not persist.
4. Stock must never fall below zero, even under concurrent payments. (FR-013, SC-006)
5. The product lookup before payment creation may use the existing bounded retry. **Mutating** stock calls are not blindly retried after an ambiguous outcome, because a retry could decrement twice for a single payment; ambiguous mutation failures are treated as failed.
6. A `503` at validation time means no payment row and no stock change. A `503`/failure during asynchronous processing means the payment row exists and ends `failed`.

### Relationships

- Zero or more payments may reference the same product.
- The product service is the sole owner of stock; the payment service never reads or writes product rows directly. (FR-015)

---

## Database Service

Runtime entity representing the dedicated database container.

| Property | Value |
|----------|-------|
| Compose service | `database` |
| Image | `postgres:17-alpine` |
| Internal port | `5432` |
| Host port | none (not published) |
| Network | `ecommerce` |
| Data directory | `/var/lib/postgresql/data` |
| Volume | `ecommerce_db_data` mounted at the data directory |
| Bootstrap database | `postgres` (`POSTGRES_DB`) |
| Logical databases | `products` (product service), `payments` (payment service) |
| Restart policy | `unless-stopped` |
| Health check | `pg_isready` against the bootstrap database |

The service is healthy only when PostgreSQL is accepting connections. Application services declare a health-gated dependency on it and also retry with bounded backoff before failing with a clear database-identifying error.

---

## Persistent Volume

| Property | Value |
|----------|-------|
| Declared name | `ecommerce_db_data` |
| Physical name | `ecommerce_ecommerce_db_data` (Compose project prefix) |
| Mount point | `/var/lib/postgresql/data` |
| Survives | Container restart, container recreation, `docker compose stop`, `docker compose down` |
| Destroyed by | `docker compose down -v`, `docker volume rm ecommerce_ecommerce_db_data`, explicit reset |
| Backup scope | None; local development volume only |

The volume is the persistence boundary. Ordinary lifecycle commands must never remove it.

---

## Database Credentials

All values are runtime configuration. None may be committed, baked into images, or written to logs.

| Variable | Consumer | Required | Default | Notes |
|----------|----------|----------|---------|-------|
| `POSTGRES_USER` | database, both services | yes | `ecommerce` | Database role and owner |
| `POSTGRES_PASSWORD` | database, both services | yes | none | Compose fails fast if absent |
| `POSTGRES_DB` | database | no | `postgres` | Bootstrap/maintenance database |
| `PGHOST` | both services | yes (Compose) | `database` in containers | `localhost` for host-only development |
| `PGPORT` | both services | yes (Compose) | `5432` | Internal only |
| `PGUSER` | both services | yes (Compose) | `${POSTGRES_USER}` | |
| `PGPASSWORD` | both services | yes (Compose) | `${POSTGRES_PASSWORD}` | |
| `PGDATABASE` | product service | yes (Compose) | `products` | |
| `PGDATABASE` | payment service | yes (Compose) | `payments` | |

`PGDATABASE` differs per service; all other `PG*` values are shared. Services use `pg`'s standard environment variables so credentials are not embedded in URLs.

---

## Reset Procedure

| Property | Value |
|----------|-------|
| Command | `bash scripts/reset-data.sh --yes` |
| Without `--yes` | Prints the destructive plan and exits non-zero without changing data |
| Effect | `docker compose down -v` (removes containers, network, and `ecommerce_db_data`), then `docker compose up --build -d` |
| Result | Empty `products` and `payments` collections; schemas re-initialized automatically |
| Verification | Script confirms `GET /api/products` returns `[]` and `GET /api/payments` returns `[]` |
| Not a reset | `docker compose restart`, `docker compose stop`, `docker compose down` (all preserve data) |

---

## Cross-Entity Invariants

| Invariant | Enforced by | Requirement |
|-----------|-------------|-------------|
| No product has negative stock | DB `CHECK` + conditional `UPDATE` | FR-013, SC-006 |
| Every stored product has all required fields | `NOT NULL` + `CHECK` | FR-003 |
| Every stored payment has all required fields | `NOT NULL` + `CHECK` | FR-004 |
| Only `pending` can transition | Guarded `UPDATE ... AND status = 'pending'` | FR-012 |
| `completed` implies a persisted decrement | Saga order: decrement → complete | FR-012 |
| Card number is never stored | Application strips to `last4`/`brand` | FR-009 |
| Services cannot read each other's data | Separate logical databases + per-service credentials | FR-015 |
| Schema init is idempotent | `CREATE ... IF NOT EXISTS`; no `DROP` | FR-006 |
| Fresh start is empty | No seed or demo data | FR-021 |
| Restart preserves records | Named volume; no truncation on startup | FR-002, SC-001 |

## API Mapping Notes

- `numeric` columns arrive from `pg` as strings; map them with `Number(...)` so JSON emits numbers (e.g. `19.99`, `24.99`), not strings.
- `timestamptz` columns arrive as `Date`; map with `.toISOString()` for the existing string format.
- `customer_info` (JSONB) round-trips as an object; do not stringify it in responses.
- Optional fields that are `null` in the database must be **omitted** from responses where the current code omits them (`orderReference`, `customerInfo`, `cardDetails`, `processedAt`, `errorMessage`) or included with the same shape as today. No new fields may appear.
