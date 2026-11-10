# Contract: Persistent Data Schema

**Feature**: `003-containerized-database`
**Status**: New storage interface
**Owners**: `product-service` (products), `payment-service` (payments)

This contract defines the logical databases, tables, constraints, indexes, and mutation semantics that back the unchanged HTTP API. Entity behavior and API mappings are in [../data-model.md](../data-model.md); runtime/operator behavior is in [database-runtime.md](./database-runtime.md).

## Database Topology

| Logical database | Owning service | Tables | Connection |
|------------------|----------------|--------|------------|
| `products` | `product-service` | `products` | `PGDATABASE=products` |
| `payments` | `payment-service` | `payments` | `PGDATABASE=payments` |
| `postgres` | database bootstrap | none created by this feature | health/init only |

**Ownership rules**

- A service MAY create, read, update, and delete rows only in its own logical database.
- No foreign key, view, or query may span `products` and `payments`.
- The payment service references a product only by the `product_id` value it received from the product service's HTTP API.
- All SQL MUST be parameterized. String interpolation into SQL is forbidden.

## Initialization Contract

### Database creation (first volume initialization only)

The database container runs `database/init/01-create-databases.sh` from `/docker-entrypoint-initdb.d` on the first initialization of an empty data directory.

| Requirement | Behavior |
|-------------|----------|
| Runs as | The official image's bootstrap process, with `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` available |
| Creates | `products` and `payments` logical databases, owned by `POSTGRES_USER` |
| Idempotent | Checks for existence before creating; re-running must not fail or drop data |
| Tables | Does **not** create application tables; each service owns its schema |
| Failure | Exits non-zero so the container fails visibly instead of starting half-configured |
| Re-run on existing volume | Does not run (PostgreSQL only executes init scripts on an empty data directory) |

### Table creation (every service startup)

Each service runs its idempotent DDL after the database is reachable and **before** it starts accepting HTTP traffic.

| Requirement | Behavior |
|-------------|----------|
| Statements | `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` only |
| Forbidden | `DROP`, `TRUNCATE`, `DELETE`, `ALTER ... DROP`, and any data-changing startup statement |
| Seed data | None; a fresh database yields empty collections (FR-021) |
| Repeatability | Safe on every restart and on an existing volume (FR-006) |
| Failure | Service logs a clear error naming the database and exits instead of serving without persistence |

## Products Table (`products` database)

### Expected DDL

```sql
CREATE TABLE IF NOT EXISTS products (
  id             uuid          PRIMARY KEY,
  name           text          NOT NULL,
  description    text          NOT NULL,
  price          numeric(12,2) NOT NULL CHECK (price > 0),
  stock_quantity integer       NOT NULL CHECK (stock_quantity >= 0),
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_created_at_idx
  ON products (created_at, id);
```

### Column contract

| Column | Type | Constraints | API field |
|--------|------|-------------|-----------|
| `id` | `uuid` | primary key, application-generated UUID v4 | `id` |
| `name` | `text` | `NOT NULL`; application requires non-empty | `name` |
| `description` | `text` | `NOT NULL`; application requires non-empty | `description` |
| `price` | `numeric(12,2)` | `NOT NULL`, `> 0` | `price` (JSON number) |
| `stock_quantity` | `integer` | `NOT NULL`, `>= 0` | `stockQuantity` |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | `createdAt` (ISO string) |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` | `updatedAt` (ISO string) |

### Required operations

| Operation | SQL semantics |
|-----------|---------------|
| List | `SELECT * FROM products ORDER BY created_at ASC, id ASC` |
| Read | `SELECT * FROM products WHERE id = $1` |
| Create | `INSERT INTO products (id, name, description, price, stock_quantity, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,now(),now()) RETURNING *` |
| Update | `UPDATE products SET name = COALESCE($2, name), description = COALESCE($3, description), price = COALESCE($4, price), stock_quantity = COALESCE($5, stock_quantity), updated_at = now() WHERE id = $1 RETURNING *` |
| Delete | `DELETE FROM products WHERE id = $1` (row count `0` → `404`, `1` → `204`) |
| Set stock | `UPDATE products SET stock_quantity = $2, updated_at = now() WHERE id = $1 RETURNING *` |
| Decrement by N | `UPDATE products SET stock_quantity = stock_quantity - $2, updated_at = now() WHERE id = $1 AND stock_quantity >= $2 RETURNING *` |
| Increment by N | `UPDATE products SET stock_quantity = stock_quantity + $2, updated_at = now() WHERE id = $1 RETURNING *` |
| Decrement by 1 (payment) | `UPDATE products SET stock_quantity = stock_quantity - 1, updated_at = now() WHERE id = $1 AND stock_quantity > 0 RETURNING *` |

- Update uses partial semantics: omitted fields are unchanged. The implementation may build the `SET` list from supplied fields, but must still use parameters.
- A conditional decrement that returns zero rows means either the product does not exist or stock is insufficient; the HTTP layer maps this to `422` with the existing message. (An extra existence check may be used to choose `404` vs `422`, but the existing stock endpoint already returns `422` for both cases and that must be preserved.)
- No application-level read-modify-write is allowed for stock.

### Integer and precision rules

- `stockQuantity`, `decrease`, and `increment` MUST be integers. Fractional values are outside the supported contract and must be rejected with `400` before reaching SQL (avoids a PostgreSQL cast error).
- `price` is stored with two decimal places. Inputs with more than two decimals are rounded by PostgreSQL and the stored value is what responses return.

## Payments Table (`payments` database)

### Expected DDL

```sql
CREATE TABLE IF NOT EXISTS payments (
  id              uuid          PRIMARY KEY,
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  currency        varchar(3)    NOT NULL DEFAULT 'USD',
  status          text          NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','completed','failed','cancelled')),
  payment_method  text          NOT NULL,
  product_id      text          NOT NULL,
  order_reference text,
  customer_info   jsonb,
  card_last4      varchar(4),
  card_brand      text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  error_message   text
);

CREATE INDEX IF NOT EXISTS payments_created_at_idx
  ON payments (created_at, id);

CREATE INDEX IF NOT EXISTS payments_product_id_idx
  ON payments (product_id);
```

### Column contract

| Column | Type | Constraints | API field |
|--------|------|-------------|-----------|
| `id` | `uuid` | primary key, application-generated UUID v4 | `id` |
| `amount` | `numeric(12,2)` | `NOT NULL`, `> 0` | `amount` (JSON number) |
| `currency` | `varchar(3)` | `NOT NULL DEFAULT 'USD'` | `currency` |
| `status` | `text` | `NOT NULL DEFAULT 'pending'`, allowed set below | `status` |
| `payment_method` | `text` | `NOT NULL` | `paymentMethod` |
| `product_id` | `text` | `NOT NULL`; no foreign key | `productId` |
| `order_reference` | `text` | nullable | `orderReference` (omitted when null) |
| `customer_info` | `jsonb` | nullable | `customerInfo` (object, omitted when null) |
| `card_last4` | `varchar(4)` | nullable | `cardDetails.last4` |
| `card_brand` | `text` | nullable | `cardDetails.brand` |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | `createdAt` (ISO string) |
| `processed_at` | `timestamptz` | nullable | `processedAt` (ISO string, omitted when null) |
| `error_message` | `text` | nullable | `errorMessage` (omitted when null) |

**Never stored**: full card number, expiry month/year, CVV, or any other raw card data.

### Status constraint

```sql
CHECK (status IN ('pending','completed','failed','cancelled'))
```

Allowed transitions (enforced by guarded `UPDATE`):

| From | To | Guard |
|------|----|-------|
| *(insert)* | `pending` | `DEFAULT 'pending'` |
| `pending` | `completed` | `WHERE id = $1 AND status = 'pending'` |
| `pending` | `failed` | `WHERE id = $1 AND status = 'pending'` |
| `pending` | `cancelled` | `WHERE id = $1 AND status = 'pending'` |
| Terminal states | — | Must not be updated by a status transition |

### Required operations

| Operation | SQL semantics |
|-----------|---------------|
| List | `SELECT * FROM payments ORDER BY created_at ASC, id ASC` |
| Read | `SELECT * FROM payments WHERE id = $1` |
| Create | `INSERT INTO payments (id, amount, currency, status, payment_method, product_id, order_reference, customer_info, card_last4, card_brand, created_at) VALUES ($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9,now()) RETURNING *` |
| Complete | `UPDATE payments SET status = 'completed', processed_at = now(), error_message = NULL WHERE id = $1 AND status = 'pending' RETURNING *` |
| Fail | `UPDATE payments SET status = 'failed', processed_at = now(), error_message = $2 WHERE id = $1 AND status = 'pending' RETURNING *` |
| Cancel | `UPDATE payments SET status = 'cancelled', processed_at = now(), error_message = $2 WHERE id = $1 AND status = 'pending' RETURNING *` |

- If a status update returns zero rows because the payment is already terminal, the service must not overwrite it and must log the condition rather than reporting success.
- `customer_info` may be passed as a JSON string or object supported by `pg`; it MUST be stored as JSONB, not as a quoted string inside JSONB.

### Money and precision rules

- `amount` is stored with two decimal places; inputs with more than two decimals are rounded by PostgreSQL.
- `numeric` values are converted to JavaScript numbers before serialization so the API continues to emit numbers.

## Cross-Service Consistency Contract

The payment flow must obey this ordering (see [../data-model.md](../data-model.md)):

```text
1. Validate input.
2. GET product from product service (retry allowed; 404/422/503 as today).
3. INSERT payment with status 'pending'.
4. Card decision:
   - decline / mock failure -> UPDATE payment to 'failed' (no stock change).
   - success -> atomic product decrement (single attempt; no blind retry of the mutation).
5. On decrement success -> UPDATE payment to 'completed'.
6. On decrement failure (no row / 422 / service unavailable) -> UPDATE payment to 'failed'.
7. If step 5 fails after step 4 succeeded -> best-effort atomic increment (compensation) and log.
```

Invariants:

- `completed` implies the decrement committed.
- `stock_quantity >= 0` always.
- Terminal statuses never change.
- Payment rows are never deleted by normal application flow.

## API Compatibility Contract

| Aspect | Required behavior |
|--------|-------------------|
| Field names | Identical to the current `Product` and `Payment` JSON |
| Types | `price`/`amount` are JSON numbers; timestamps are ISO-8601 strings |
| Optional fields | Omitted or `null` exactly as today; no new fields |
| List order | Stable: `created_at ASC, id ASC` (matches insertion order of the previous `Map`) |
| Status codes | Unchanged: `200`, `201`, `204`, `400`, `404`, `422`, `503` |
| Error shape | Unchanged: `{ "error": "...", "message": "..." }` |
| Persistence | Records survive restarts; no schema change to the HTTP contract |

## Out of Scope

- Migrations from the in-memory store.
- Seed/demo data.
- Cross-database foreign keys or distributed transactions.
- Backup, replication, partitioning, retention, and archival.
- Storing raw card data.
