# Quickstart: Persistent Database Validation

**Feature**: `003-containerized-database`
**Purpose**: Run and prove the stack end-to-end: persistence across restarts, unchanged API behavior, database isolation, concurrency safety, and explicit reset.

This is a validation guide. Storage behavior is defined in [data-model.md](./data-model.md), [contracts/database-runtime.md](./contracts/database-runtime.md), and [contracts/data-schema.md](./contracts/data-schema.md).

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Docker Engine 24+ with Compose v2+ | `docker compose version` must work |
| `curl` and `jq` | Used by the verification scripts |
| `bash` | Scripts are Bash 4+ |
| Free host port `8080` | Gateway only; no local dev server running |
| ~2 minutes and network access on first run | PostgreSQL image pull and image builds |

No local PostgreSQL client, manual database creation, or manual SQL is required.

## 1. Prepare configuration

From the repository root:

```bash
cp .env.example .env
```

Set a password in `.env`:

```dotenv
POSTGRES_USER=ecommerce
POSTGRES_PASSWORD=choose-a-local-password
POSTGRES_DB=postgres
```

`.env` is gitignored and must never be committed. The stack fails fast if `POSTGRES_PASSWORD` is missing. See [contracts/database-runtime.md](./contracts/database-runtime.md#environment-contract) for the full variable list.

## 2. Start the stack

```bash
docker compose up --build -d --wait
```

Expected:

```text
✔ Container ecommerce-database-1          Healthy
✔ Container ecommerce-product-service-1   Healthy
✔ Container ecommerce-payment-service-1   Healthy
✔ Container ecommerce-api-gateway-1       Healthy
```

Confirm:

```bash
docker compose ps
curl -s http://localhost:8080/health
# {"status":"ok","service":"api-gateway"}
```

The first start creates the `ecommerce_db_data` volume, creates the `products` and `payments` logical databases, and lets each service create its own table. No manual step is needed.

## 3. Prove API behavior is unchanged

```bash
bash scripts/smoke-test.sh
```

Expected: 11 `PASS` lines ending with `All smoke tests passed.` This covers product create/list/read/update/delete, payment completion, stock decrement, and error shapes.

```bash
bash scripts/verify-isolation.sh
```

Expected: host reaches `:8080`; host access to `:3001`, `:3002`, and `:5432` is refused; the compose file has no `ports:` mapping for `database`; an internal payment completes and decrements stock.

## 4. Prove persistence across restarts

Use the script:

```bash
bash scripts/persistence-test.sh
```

Expected: a `PASS` line for each cycle and a final line reading `All persistence cycles passed; data survived restart, stop/start, down/up, and a database-only restart.`

The script:

1. Creates a product and a successful payment, then waits for the payment to reach `completed`.
2. Snapshots the product ID/name/price/stock and the payment ID/status/amount/card summary.
3. Runs `docker compose restart`, `docker compose stop` + `start`, and `docker compose down` + `up -d --wait` (no `-v`).
4. Restarts only the `database` service and waits for both services to serve database-backed reads again.
5. After every cycle re-reads the product and payment and asserts the snapshots are identical, failing on the first mismatch.

### Manual equivalent

```bash
BASE=http://localhost:8080

PRODUCT_ID="$(curl -sS -X POST "$BASE/api/products" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Persistence Widget","description":"survives restarts","price":19.99,"stockQuantity":5}' \
  | jq -r .id)"

PAYMENT_ID="$(curl -sS -X POST "$BASE/api/payments" \
  -H 'Content-Type: application/json' \
  -d "{\"amount\":19.99,\"currency\":\"USD\",\"paymentMethod\":\"credit_card\",\"productId\":\"$PRODUCT_ID\",\"customerInfo\":{\"name\":\"Persistence Test\"},\"cardDetails\":{\"number\":\"4111111111111111\",\"expiryMonth\":12,\"expiryYear\":2030,\"cvv\":\"123\"}}" \
  | jq -r .id)"

# Wait for the payment to become completed.
for _ in $(seq 1 20); do
  [ "$(curl -sS "$BASE/api/payments/$PAYMENT_ID" | jq -r .status)" = "completed" ] && break
  sleep 0.5
done

# Cycle 1: restart containers.
docker compose restart
docker compose up -d --wait

# Cycle 2: stop and start.
docker compose stop
docker compose start
docker compose up -d --wait

# Cycle 3: remove and recreate containers (volume preserved).
docker compose down
docker compose up -d --wait

# After each cycle (wait for healthy), verify:
curl -sS "$BASE/api/products/$PRODUCT_ID" | jq '{id,name,price,stockQuantity}'
curl -sS "$BASE/api/payments/$PAYMENT_ID" | jq '{id,status,amount,cardDetails}'
```

Expected after every cycle: the same product (`stockQuantity: 4` after the completed payment) and the same completed payment.

### Restart only the database

```bash
docker compose restart database
docker compose up -d --wait
curl -sS "$BASE/api/products/$PRODUCT_ID" | jq .
```

Expected: the product is still present and the services resume serving. Data is not lost because it lives in the named volume, not the container.

## 5. Prove the database is not reachable from the host

```bash
# Nothing should be listening on the host at 5432.
ss -ltn | grep ':5432' && echo "UNEXPECTED: database port is published" || echo "OK: no host listener"

# Compose should not report a published port for the database.
docker compose port database 5432 || true

# Connection attempt must fail.
python3 -c 'import socket,sys; s=socket.socket(); s.settimeout(2); sys.exit(0 if s.connect_ex(("127.0.0.1",5432))==0 else 1)' \
  && echo "UNEXPECTED: database port is reachable" \
  || echo "OK: database port refused"
```

Expected: no listener, no published port, connection refused.

## 6. Prove concurrency does not oversell

```bash
bash scripts/concurrency-test.sh
```

Expected: a product with stock `10` receives 20 concurrent purchase attempts; exactly 10 payments reach `completed`; the rest fail or are rejected with `422`; final stock is `0` and never negative.

Manual sketch:

```bash
BASE=http://localhost:8080
PRODUCT_ID="$(curl -sS -X POST "$BASE/api/products" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Concurrency Widget","description":"limited stock","price":5.00,"stockQuantity":10}' \
  | jq -r .id)"

for i in $(seq 1 20); do
  curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/payments" \
    -H 'Content-Type: application/json' \
    -d "{\"amount\":5.00,\"paymentMethod\":\"credit_card\",\"productId\":\"$PRODUCT_ID\",\"cardDetails\":{\"number\":\"4111111111111111\",\"expiryMonth\":12,\"expiryYear\":2030,\"cvv\":\"123\"}}" &
done
wait
sleep 2

curl -sS "$BASE/api/products/$PRODUCT_ID" | jq '.stockQuantity'   # 0
curl -sS "$BASE/api/payments" \
  | jq --arg pid "$PRODUCT_ID" '[.[] | select(.productId == $pid)] | group_by(.status) | map({status: .[0].status, count: length})'
```

Expected: `stockQuantity` is `0`, exactly `10` payments are `completed`, and no payment is completed beyond the available stock.

## 7. Prove explicit reset

```bash
# Refuses without confirmation, prints what would be destroyed, and exits 2.
bash scripts/reset-data.sh

# Destructive: removes the named volume, recreates the stack, and verifies empty collections.
bash scripts/reset-data.sh --yes
```

Expected after `--yes`:

```bash
curl -sS http://localhost:8080/api/products | jq .   # []
curl -sS http://localhost:8080/api/payments | jq .   # []
```

The full reset sequence is `docker compose down -v` followed by `docker compose up --build -d --wait`; the script automates and verifies it. **Never** use `-v` if you want to keep data.

## 8. Inspect the database through the stack interface

```bash
docker compose ps                      # database should be present and healthy
docker compose logs --tail 50 database # startup, init, and connection logs
docker compose exec database sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Logs must not contain the database password.

## Success Checklist

| Check | Expected | Requirement |
|-------|----------|-------------|
| `docker compose ps` | Four services, all healthy | FR-001, FR-016 |
| `scripts/smoke-test.sh` | 11/11 pass | FR-014, SC-002 |
| `scripts/persistence-test.sh` | Identical records after restart, stop/start, down/up, and a database-only restart | FR-002, SC-001 |
| `docker compose restart database` | Data intact, services resume | FR-017, SC-009 |
| `scripts/verify-isolation.sh` | `:5432` refused from host | FR-007, SC-005 |
| `scripts/concurrency-test.sh` | Stock ends at 0, 10 completed, no oversell | FR-013, SC-006 |
| `scripts/reset-data.sh --yes` | Products `[]`, payments `[]` | FR-018, SC-008 |
| Startup from clean checkout | Working in under 5 minutes, no manual DB steps | FR-005, SC-003 |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `POSTGRES_PASSWORD must be set in .env` | `.env` missing or empty | `cp .env.example .env`, set the password, rerun |
| `database` stays `starting` / `unhealthy` | Image still pulling, slow disk, or init failure | `docker compose logs database`; wait, or check disk space |
| Services restart with `ECONNREFUSED` / auth errors | Database not healthy or credentials mismatch | Confirm `POSTGRES_USER`/`POSTGRES_PASSWORD` match in `.env`; recreate with `docker compose up -d --force-recreate` |
| Services start before database is ready | Health gating missing or bypassed | Ensure `depends_on: database: condition: service_healthy`; services also retry briefly |
| Payment returns `503` | Product service or database unavailable | `docker compose ps`; `docker compose logs product-service database`; retry once healthy |
| Payment returns `422` | Product out of stock or missing | Expected under concurrency; create more stock or a new product |
| Data gone after a restart | Someone ran `down -v` or removed the volume | Check history; data cannot be recovered. Next start is empty and documented |
| Reset did not clear data | `down -v` was not used, or a stale volume remains | `docker volume ls \| grep ecommerce_db_data`; rerun `bash scripts/reset-data.sh --yes` |
| Host can reach `:5432` | A `ports:` mapping was added for the database | Remove the mapping from `docker-compose.yml` and recreate the stack |
| Port `8080` already in use | Local dev server is still running | Stop it (`pkill -f ts-node-dev`) or free the port, then restart |
| First start is slow | Initial image pull / build | Re-run `docker compose up --build -d --wait`; subsequent starts are faster |

## What Not to Do

- Do not add a host `ports:` mapping for `5432` under the default setup.
- Do not use `docker compose down -v` unless you intend to destroy data.
- Do not run manual `CREATE TABLE` or seed SQL; schema initialization is automatic and idempotent.
- Do not commit `.env` or real credentials.
- Do not expect pre-feature in-memory data to be migrated; the first persistent start is empty.
