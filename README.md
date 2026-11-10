# e-commerce

Microservices architecture for e-commerce with an API Gateway centralizing traffic routing to the Product and Payment services.

## Architecture

- **API Gateway** (port 8080) — public entry point; routes requests to the backend services
- **Product Service** (port 3001, internal) — product catalog and inventory
- **Payment Service** (port 3002, internal) — payment processing and stock coordination
- **Database** (PostgreSQL 17, internal) — persistent storage in its own container; no host port. Holds separate `products` and `payments` logical databases.

## Features

- Product CRUD operations
- Product catalog browsing and stock tracking
- Payment processing with a mock gateway
- Prevention of overselling
- Data that survives restarts through a named Docker volume
- RESTful API design
- One-command containerized stack

## Quick Start (Docker)

### Prerequisites

- Docker Engine 24+ with the Compose v2+ plugin
- No local Node.js or npm installation is required to run the stack

Verify:

```bash
docker --version
docker compose version
```

### Start

Make sure no local development servers are using port 8080. If the legacy workflow is running, stop it first (Ctrl+C in its terminal, or `pkill -f ts-node-dev`).

Create the local configuration once and set a database password:

```bash
cp .env.example .env
# edit .env and set POSTGRES_PASSWORD to a local-only value
```

`.env` is gitignored and is never committed. Compose refuses to start if `POSTGRES_PASSWORD` is missing.

From the repository root:

```bash
docker compose up --build -d --wait
```

This builds and starts all four containers. The first start pulls PostgreSQL, creates the `ecommerce_db_data` named volume, creates the `products` and `payments` logical databases, and lets each service create its own table automatically. No manual database setup is required.

Check readiness:

```bash
docker compose ps
```

All four services should report `healthy` (`database`, `product-service`, `payment-service`, `api-gateway`). Then call the gateway:

```bash
curl http://localhost:8080/health
# {"status":"ok","service":"api-gateway"}
```

Only the API gateway is published to the host. The backend services and PostgreSQL are reachable only over the internal Docker network; port `5432` is not published.

### Stop

```bash
docker compose down
```

This removes the containers and the shared network and releases port 8080, but it **preserves the `ecommerce_db_data` named volume**. Products and payments remain available the next time the stack starts.

To permanently delete all persisted data, use the guarded reset script (see [Verification Scripts](#verification-scripts)):

```bash
bash scripts/reset-data.sh --yes   # destructive: runs `docker compose down -v`
```

`docker compose down -v` (and the reset script) is the only supported way to start from an empty database.

## API Endpoints

All requests go through the gateway at `http://localhost:8080`.

### Products

- `GET /api/products` — List all products
- `GET /api/products/:id` — Get product details
- `POST /api/products` — Create a product
- `PUT /api/products/:id` — Update a product
- `DELETE /api/products/:id` — Delete a product
- `PATCH /api/products/:id/stock` — Adjust stock

### Payments

- `POST /api/payments` — Initiate a payment
- `GET /api/payments/:id` — Get payment status
- `GET /api/payments` — List payments

Payment example (card `4111111111111111` always succeeds in the mock gateway):

```bash
curl -X POST http://localhost:8080/api/payments \
  -H 'Content-Type: application/json' \
  -d '{
    "amount": 24.99,
    "currency": "USD",
    "paymentMethod": "credit_card",
    "productId": "<PRODUCT_ID>",
    "customerInfo": {"name": "Test User", "email": "test@example.com"},
    "cardDetails": {"number": "4111111111111111", "expiryMonth": 12, "expiryYear": 2030, "cvv": "123"}
  }'
```

Payment processing is asynchronous: the create call returns `pending`, and a successful payment later becomes `completed` while decrementing product stock.

## Verification Scripts

With the stack running:

```bash
# Product CRUD, payment completion, stock decrement, and error shapes
bash scripts/smoke-test.sh

# Host isolation and internal service discovery (rejects host access to 5432)
bash scripts/verify-isolation.sh

# Data survives restart, stop/start, down/up, and a database-only restart
bash scripts/persistence-test.sh

# Concurrent purchases cannot oversell stock
bash scripts/concurrency-test.sh

# Guarded, destructive reset; without --yes it changes nothing
bash scripts/reset-data.sh
bash scripts/reset-data.sh --yes
```

All scripts require `curl`, `jq`, and `docker`, and exit non-zero on the first failed assertion. `reset-data.sh` without `--yes` exits with status 2 after printing what would be destroyed; with `--yes` it runs `docker compose down -v`, rebuilds the stack, and verifies that both collections are empty.

For a simple, human-readable tour of the API with the raw `curl` commands included, run:

```bash
bash test-api.sh
```

For a complete manual walkthrough, including expected values, see [quickstart.md](specs/002-dockerize-microservices/quickstart.md).

## Operations

| Task | Command |
|------|---------|
| Start / rebuild | `docker compose up --build -d --wait` |
| Status | `docker compose ps` |
| Logs (all services) | `docker compose logs -f` |
| Logs (one service) | `docker compose logs -f api-gateway` |
| Logs (database) | `docker compose logs -f database` |
| Restart everything (keeps data) | `docker compose restart` |
| Restart database only (keeps data) | `docker compose restart database` |
| Stop and remove (keeps data) | `docker compose down` |
| Stop and **destroy data** | `docker compose down -v` or `bash scripts/reset-data.sh --yes` |
| Full rebuild | `docker compose build --no-cache && docker compose up -d --wait` |

### Persistence and backups

- Data lives in the `ecommerce_db_data` named volume (physical name `ecommerce_ecommerce_db_data`).
- `restart`, `stop`/`start`, `down`, and container recreation all keep the volume and therefore the data.
- Only `down -v`, `docker volume rm ecommerce_ecommerce_db_data`, or `scripts/reset-data.sh --yes` remove it.
- Schema initialization is idempotent (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`) and creates no seed data. A fresh volume starts empty.
- There is no automated backup, replication, or point-in-time recovery. This is local development storage only. To keep a copy, stop the stack and back up the Docker volume with your usual volume-backup tooling.
- The full card number, expiry, and CVV are never stored; only `cardDetails.last4` and `cardDetails.brand` are persisted.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Bind for 0.0.0.0:8080 failed` | A local dev server is already on port 8080 | Stop the legacy stack (`pkill -f ts-node-dev`), confirm with `ss -ltnp \| grep :8080`, then start again |
| `docker: 'compose' is not a docker command` | Compose plugin missing | Install the Docker Compose plugin |
| `POSTGRES_PASSWORD must be set in .env` | `.env` missing or the variable is empty | `cp .env.example .env`, set a local password, and rerun |
| `database` stays `starting` / `unhealthy` | Image still pulling, slow disk, or init failure | `docker compose logs database`; wait, check disk space, then recreate with `docker compose up -d --force-recreate` |
| Services log authentication failures | `POSTGRES_USER`/`POSTGRES_PASSWORD` changed after the volume was initialized | Restore the original credentials, or destroy and recreate the volume with `bash scripts/reset-data.sh --yes` (data loss) |
| A service stays `unhealthy` | App failed to start, often because the database is unreachable | `docker compose logs <service> database`; the service retries briefly and then exits with a database-identifying error |
| Payment returns `503` | Product service or a database is unavailable | `docker compose ps`; `docker compose logs product-service payment-service database`; retry once healthy |
| Payment returns `404` | `productId` does not exist | Create a product first and use its `id` |
| Payment returns `422` | Product out of stock or missing | Expected under concurrency; create more stock or a new product |
| Products/payments gone after a restart | The named volume was removed (`down -v` or reset) | Check `docker volume ls \| grep ecommerce_db_data`. Removed data cannot be recovered; the next start is empty |
| Trailing `pending` payment after a crash | The service stopped between the pending insert and the async saga | Expected limitation: terminal status is assigned only when processing runs. No stock was decremented unless the payment is `completed` |
| Host can reach `:5432` | A `ports:` mapping was added for the database | Remove it from `docker-compose.yml` and recreate the stack; `bash scripts/verify-isolation.sh` fails when a mapping exists |
| Build fails fetching packages | No network access during build | Restore network access or configure a registry mirror |

## Local Development (without containers)

Node.js 22 and npm are required, plus a reachable PostgreSQL 17 instance. The Compose `database` service deliberately publishes no host port, so start a host-only development database (or temporarily map `5432`) and point the services at it:

```bash
docker run --rm -d --name ecommerce-db-dev \
  -e POSTGRES_USER=ecommerce \
  -e POSTGRES_PASSWORD=choose-a-local-password \
  -e POSTGRES_DB=postgres \
  -p 5432:5432 \
  -v "$PWD/database/init:/docker-entrypoint-initdb.d:ro" \
  postgres:17-alpine

export PGHOST=localhost PGPORT=5432 PGUSER=ecommerce PGPASSWORD=choose-a-local-password
```

Install dependencies once per service:

```bash
cd api-gateway && npm install && cd ..
cd product-service && npm install && cd ..
cd payment-service && npm install && cd ..
```

Start everything:

```bash
./start-all.sh
```

`start-all.sh` sets `PGDATABASE=products` for the product service and `PGDATABASE=payments` for the payment service. Or run each service individually with `npm run dev` in its directory and set the matching `PGDATABASE` yourself. The services default to `http://localhost:3001` / `http://localhost:3002`, so the non-containerized workflow behaves as before once PostgreSQL is reachable.

## Configuration

| Variable | Used by | Default | Container value |
|----------|---------|---------|-----------------|
| `PORT` | all services | 8080 / 3001 / 3002 | same |
| `NODE_ENV` | all services | `development` | `production` |
| `PRODUCT_SERVICE_URL` | gateway, payment | `http://localhost:3001` | `http://product-service:3001` |
| `PAYMENT_SERVICE_URL` | gateway | `http://localhost:3002` | `http://payment-service:3002` |
| `POSTGRES_USER` | database, product, payment | `ecommerce` | same |
| `POSTGRES_PASSWORD` | database, product, payment | none; required | value from `.env` |
| `POSTGRES_DB` | database | `postgres` | same |
| `PGHOST` | product, payment | `localhost` (local dev) | `database` |
| `PGPORT` | product, payment | `5432` | `5432` |
| `PGUSER` | product, payment | `POSTGRES_USER` | `${POSTGRES_USER}` |
| `PGPASSWORD` | product, payment | `POSTGRES_PASSWORD` | `${POSTGRES_PASSWORD}` |
| `PGDATABASE` | product service | `products` | `products` |
| `PGDATABASE` | payment service | `payments` | `payments` |

See [.env.example](.env.example) for documented defaults. Compose supplies the container values; no rebuild is needed to change them. `.env` is gitignored and must never contain committed production credentials.

## Documentation

- [Persistent database specification](specs/003-containerized-database/spec.md)
- [Persistent database plan](specs/003-containerized-database/plan.md)
- [Persistent database quickstart / validation](specs/003-containerized-database/quickstart.md)
- [Data model](specs/003-containerized-database/data-model.md)
- [Data schema contract](specs/003-containerized-database/contracts/data-schema.md)
- [Database runtime contract](specs/003-containerized-database/contracts/database-runtime.md)
- [Containerization specification](specs/002-dockerize-microservices/spec.md)
- [Containerization plan](specs/002-dockerize-microservices/plan.md)
- [Container quickstart / validation](specs/002-dockerize-microservices/quickstart.md)
- [HTTP API contract](specs/002-dockerize-microservices/contracts/http-api.md)
- [Container runtime contract](specs/002-dockerize-microservices/contracts/container-runtime.md)
- [Original backend spec](specs/001-simple-ecommerce-backend/spec.md)
- [API contracts (OpenAPI)](specs/001-simple-ecommerce-backend/contracts/openapi.yaml)
- [Data model](specs/001-simple-ecommerce-backend/data-model.md)
