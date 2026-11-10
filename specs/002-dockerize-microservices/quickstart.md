# Quickstart Validation Guide: Containerized E-commerce Stack

**Feature**: `002-dockerize-microservices`
**Purpose**: Prove the containerized stack works end-to-end through the public gateway.

This is a validation guide, not an implementation guide. Contracts and data details live in [contracts/](./contracts/) and [data-model.md](./data-model.md).

## Prerequisites

1. **Docker Engine 24+ with Compose v2+**
   ```bash
   docker --version
   docker compose version
   ```
   This environment reports Docker 29.9.3 and Compose v5.7.0.

2. **Repository checkout** at the project root, with the container files from this feature present.

3. **Host port 8080 free.**
   The legacy local workflow may still be running. Check:
   ```bash
   ss -ltnp | grep -E ':(8080|3001|3002)'
   ```
   If port 8080 is held by local `node`/`ts-node-dev` processes, stop the legacy stack first (Ctrl+C in the `start-all.sh` terminal, or):
   ```bash
   pkill -f 'ts-node-dev' || true
   ```
   Only port 8080 is published by the containerized stack, so 3001/3002 are not required to be free; stopping the legacy stack avoids confusion about which environment answered a request.

4. **No host Node.js/npm required** to run the stack. They are only needed for the optional local development workflow.

## 1. Start the Stack

From the repository root:

```bash
docker compose up --build -d
```

Expected: three images build, three containers start, and Compose exits after reporting them as started. First build may take a few minutes; subsequent starts are fast.

Check status until all services show `healthy` (allow up to 60 seconds):

```bash
docker compose ps
```

Expected rows: `api-gateway`, `product-service`, `payment-service`, all `running` / `healthy`.

**Pass condition**: gateway is healthy and both backend services are healthy.

## 2. Verify the Gateway

```bash
curl -s http://localhost:8080/health
```

Expected:

```json
{"status":"ok","service":"api-gateway"}
```

**Pass condition**: HTTP 200 with the gateway identity.

## 3. Verify Backend Isolation

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/health || echo "refused (expected)"
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3002/health || echo "refused (expected)"
```

Expected: connection refused (`000`/error), because only the gateway is published.

**Pass condition**: neither backend is reachable from the host, while the gateway is.

## 4. Verify Product Flow Through the Gateway

Create a product:

```bash
curl -s -X POST http://localhost:8080/api/products \
  -H 'Content-Type: application/json' \
  -d '{"name":"Container Widget","description":"Validation product","price":19.99,"stockQuantity":5}'
```

Expected: HTTP 201 and a product object with `id`, `stockQuantity: 5`, `createdAt`, `updatedAt`.

List products:

```bash
curl -s http://localhost:8080/api/products
```

Fetch and update the product (replace `<PRODUCT_ID>` with the `id` from the create response):

```bash
curl -s http://localhost:8080/api/products/<PRODUCT_ID>
curl -s -X PUT http://localhost:8080/api/products/<PRODUCT_ID> \
  -H 'Content-Type: application/json' \
  -d '{"price":24.99}'
```

Expected: `200` responses; the updated price is reflected.

**Pass condition**: create, list, read, and update all work through port 8080.

## 5. Verify Payment and Stock Flow (Internal Networking)

Submit a payment using the success test card and the product created above:

```bash
curl -s -X POST http://localhost:8080/api/payments \
  -H 'Content-Type: application/json' \
  -d '{
    "amount":24.99,
    "currency":"USD",
    "paymentMethod":"credit_card",
    "productId":"<PRODUCT_ID>",
    "customerInfo":{"name":"Test User","email":"test@example.com"},
    "cardDetails":{"number":"4111111111111111","expiry":"12/30","cvv":"123"}
  }'
```

Expected: HTTP 201, payment with `status: "pending"`. Note the payment `id`.

Wait for asynchronous processing, then check status and stock:

```bash
sleep 2
curl -s http://localhost:8080/api/payments/<PAYMENT_ID>
curl -s http://localhost:8080/api/products/<PRODUCT_ID>
```

Expected:
- Payment `status` becomes `completed`.
- Product `stockQuantity` decreases from 5 to 4.

This proves the payment service reached the product service over the internal network using service DNS names.

**Pass condition**: payment completes and stock decrements, with all calls made through port 8080.

## 6. Verify Error Behavior

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/unknown
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/products/does-not-exist
```

Expected: `404` for both, with the existing not-found JSON shape.

**Pass condition**: unknown route and missing resource return the documented contract.

## 7. Inspect Logs

```bash
docker compose logs --tail=50
docker compose logs -f api-gateway
```

Expected: readable stdout/stderr from all services; no crash loops or unhandled rejections.

**Pass condition**: logs for the whole stack are available from the root with one command.

## 8. Restart and Teardown

```bash
docker compose restart
docker compose ps
```

Then remove everything:

```bash
docker compose down
docker compose ps
```

Expected after `down`: no containers listed, port 8080 released, network removed.

Start again and confirm the stack returns with **empty** product/payment data (in-memory state reset):

```bash
docker compose up -d
curl -s http://localhost:8080/api/products
```

Expected: `[]`.

**Pass condition**: clean restart and teardown with no orphaned resources; data reset is expected.

## Optional: Automated Smoke Test

If `scripts/smoke-test.sh` is present:

```bash
bash scripts/smoke-test.sh
```

Expected: the script exits `0` after exercising health, product CRUD, payment completion, and stock decrement through the gateway.

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| `Bind for 0.0.0.0:8080 failed` | Legacy dev gateway still running | Stop the local stack; confirm with `ss -ltnp \| grep :8080` |
| `docker: 'compose' is not a docker command` | Compose plugin missing | Install the Docker Compose plugin, then retry |
| A service stays `unhealthy` | App failed to start or wrong `PORT` | `docker compose logs <service>`; rebuild with `--no-cache` |
| Payment returns `503` | Product service not ready/unreachable | `docker compose ps`; confirm product service is healthy; retry |
| Payment returns `404` | `productId` does not exist | Recheck the created product id |
| Data disappeared after restart | In-memory storage by design | Expected; no persistence in this feature |
| Build fails fetching packages | No network access during build | Restore network access or configure a registry mirror |

## Success Checklist

- [ ] `docker compose up --build -d` starts all three services
- [ ] Gateway health returns `200 {"status":"ok","service":"api-gateway"}`
- [ ] Backend ports 3001/3002 are not reachable from the host
- [ ] Product create/list/read/update work through `:8080`
- [ ] Payment completes and stock decrements via internal DNS
- [ ] Unknown route and missing resource return `404`
- [ ] Logs for all services available with one command
- [ ] `docker compose down` leaves no containers, network, or occupied ports
- [ ] Restart yields fresh, empty in-memory data
