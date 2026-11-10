# e-commerce

Microservices architecture for e-commerce with an API Gateway centralizing traffic routing to the Product and Payment services.

## Architecture

- **API Gateway** (port 8080) — public entry point; routes requests to the backend services
- **Product Service** (port 3001, internal) — product catalog and inventory
- **Payment Service** (port 3002, internal) — payment processing and stock coordination

## Features

- Product CRUD operations
- Product catalog browsing and stock tracking
- Payment processing with a mock gateway
- Prevention of overselling
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

From the repository root:

```bash
docker compose up --build -d
```

This builds and starts all three services. Check readiness:

```bash
docker compose ps
```

All three services should report `running` / `healthy`. Then call the gateway:

```bash
curl http://localhost:8080/health
# {"status":"ok","service":"api-gateway"}
```

Only the API gateway is published to the host. The backend services are reachable only over the internal Docker network.

### Stop

```bash
docker compose down
```

This removes the containers and the shared network and releases port 8080. Product and payment data is stored in memory, so it is **reset on every restart or teardown** — this is expected.

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

# Host isolation and internal service discovery
bash scripts/verify-isolation.sh
```

Both scripts require `curl` and `jq`, and exit non-zero on the first failed assertion.

For a complete manual walkthrough, including expected values, see [quickstart.md](specs/002-dockerize-microservices/quickstart.md).

## Operations

| Task | Command |
|------|---------|
| Start / rebuild | `docker compose up --build -d` |
| Status | `docker compose ps` |
| Logs (all services) | `docker compose logs -f` |
| Logs (one service) | `docker compose logs -f api-gateway` |
| Restart everything | `docker compose restart` |
| Stop and remove | `docker compose down` |
| Full rebuild | `docker compose build --no-cache && docker compose up -d` |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Bind for 0.0.0.0:8080 failed` | A local dev server is already on port 8080 | Stop the legacy stack (`pkill -f ts-node-dev`), confirm with `ss -ltnp \| grep :8080`, then start again |
| `docker: 'compose' is not a docker command` | Compose plugin missing | Install the Docker Compose plugin |
| A service stays `unhealthy` | App failed to start | `docker compose logs <service>`; rebuild with `docker compose build --no-cache` |
| Payment returns `503` | Product service not ready or unreachable | Wait for `docker compose ps` to show product-service healthy, then retry |
| Payment returns `404` | `productId` does not exist | Create a product first and use its `id` |
| Products disappear after restart | In-memory storage | Expected; persistence is out of scope |
| Build fails fetching packages | No network access during build | Restore network access or configure a registry mirror |

## Local Development (without containers)

Node.js 22 and npm are required. Install dependencies once per service:

```bash
cd api-gateway && npm install && cd ..
cd product-service && npm install && cd ..
cd payment-service && npm install && cd ..
```

Start everything:

```bash
./start-all.sh
```

Or run each service individually with `npm run dev` in its directory. The services default to `http://localhost:3001` / `http://localhost:3002`, so the non-containerized workflow behaves as before.

## Configuration

| Variable | Used by | Default | Container value |
|----------|---------|---------|-----------------|
| `PORT` | all services | 8080 / 3001 / 3002 | same |
| `NODE_ENV` | all services | `development` | `production` |
| `PRODUCT_SERVICE_URL` | gateway, payment | `http://localhost:3001` | `http://product-service:3001` |
| `PAYMENT_SERVICE_URL` | gateway | `http://localhost:3002` | `http://payment-service:3002` |

See [.env.example](.env.example) for documented defaults. Compose supplies the container values; no rebuild is needed to change them.

## Documentation

- [Feature specification](specs/002-dockerize-microservices/spec.md)
- [Implementation plan](specs/002-dockerize-microservices/plan.md)
- [Container quickstart / validation](specs/002-dockerize-microservices/quickstart.md)
- [HTTP API contract](specs/002-dockerize-microservices/contracts/http-api.md)
- [Container runtime contract](specs/002-dockerize-microservices/contracts/container-runtime.md)
- [Original backend spec](specs/001-simple-ecommerce-backend/spec.md)
- [API contracts (OpenAPI)](specs/001-simple-ecommerce-backend/contracts/openapi.yaml)
- [Data model](specs/001-simple-ecommerce-backend/data-model.md)
