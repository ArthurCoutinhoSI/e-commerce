# Contract: Public HTTP API Through the Gateway

**Feature**: `002-dockerize-microservices`
**Status**: Unchanged contract — must remain backward compatible

This contract restates the externally observable API after containerization. The authoritative schema is the existing [OpenAPI 3.0 document](../../001-simple-ecommerce-backend/contracts/openapi.yaml); this file records the guarantees containerization must preserve.

## Base URL

| Environment | Base URL |
|-------------|----------|
| Host (documented) | `http://localhost:8080` |
| Container network | `http://api-gateway:8080` |

Only the gateway is published to the host. Clients MUST NOT be required to know backend container names or ports.

## Preserved Endpoints

### Products (proxied to `product-service`)

| Method | Gateway path | Backend path | Success |
|--------|--------------|--------------|---------|
| GET | `/api/products` | `/products` | `200` + array |
| GET | `/api/products/:id` | `/products/:id` | `200` + object |
| POST | `/api/products` | `/products` | `201` + created object |
| PUT | `/api/products/:id` | `/products/:id` | `200` + updated object |
| DELETE | `/api/products/:id` | `/products/:id` | `204` no body |
| PATCH | `/api/products/:id/stock` | `/products/:id/stock` | `200` + updated object |

### Payments (proxied to `payment-service`)

| Method | Gateway path | Backend path | Success |
|--------|--------------|--------------|---------|
| GET | `/api/payments` | `/payments` | `200` + array |
| GET | `/api/payments/:id` | `/payments/:id` | `200` + object |
| POST | `/api/payments` | `/payments` | `201` + created object |

### Platform endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Gateway readiness; `{ "status": "ok", "service": "api-gateway" }` |
| ANY | unknown | `404` `{ "error": "Not Found", "message": "Route not found" }` |

## Behavior Guarantees

1. **Path rewriting is unchanged**: `/api/products/*` is forwarded as `/products/*`; `/api/payments/*` as `/payments/*`.
2. **Request/response bodies and status codes are unchanged** from the non-containerized implementation.
3. **CORS behavior is unchanged** (permissive, as currently configured).
4. **Payment processing remains asynchronous**: `POST /api/payments` returns `201` with `status: "pending"`; clients poll `GET /api/payments/:id` until `completed` or `failed`.
5. **Stock side effect remains**: a successful payment decrements product stock by one through the internal network.
6. **Test-card semantics remain**: `4111...` completes, `4000...` is declined, other cards succeed approximately 90% of the time.
7. **Backend unavailability is explicit**: if the product service cannot be reached, payment creation returns a clear `503`-class error rather than `404 "Product not found"` or a crash. A genuinely missing product still returns `404`.

## Error Contract

| Condition | Status | Shape |
|-----------|--------|-------|
| Validation failure | `400` | `{ "error": "Bad Request", "message": "..." }` |
| Missing resource | `404` | `{ "error": "Not Found", "message": "..." }` |
| Insufficient stock | `422` | `{ "error": "Unprocessable Entity", "message": "..." }` |
| Dependency unavailable | `503` | `{ "error": "Service Unavailable", "message": "..." }` |
| Unknown route | `404` | `{ "error": "Not Found", "message": "Route not found" }` |

## Verification

- `GET http://localhost:8080/health` → `200` with gateway identity.
- Product CRUD through the gateway on port 8080 only.
- Payment flow through the gateway on port 8080 only.
- Direct requests to `http://localhost:3001` and `http://localhost:3002` MUST fail from the host.
- Schema conformance: [OpenAPI document](../../001-simple-ecommerce-backend/contracts/openapi.yaml).
- Runnable scenarios: [quickstart.md](../quickstart.md).
