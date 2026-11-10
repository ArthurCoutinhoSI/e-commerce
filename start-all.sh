#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting all services for local development (non-containerized)..."

# Start Product Service
(cd product-service && npm run dev) &
PRODUCT_PID=$!
echo "Product Service started (PID: $PRODUCT_PID)"

# Start Payment Service
(cd payment-service && npm run dev) &
PAYMENT_PID=$!
echo "Payment Service started (PID: $PAYMENT_PID)"

# Start API Gateway
(cd api-gateway && npm run dev) &
GATEWAY_PID=$!
echo "API Gateway started (PID: $GATEWAY_PID)"

echo ""
echo "All services starting..."
echo "API Gateway: http://localhost:8080"
echo "Product Service: http://localhost:3001"
echo "Payment Service: http://localhost:3002"
echo ""
echo "Press Ctrl+C to stop all services"

trap 'echo "Stopping services..."; kill $PRODUCT_PID $PAYMENT_PID $GATEWAY_PID 2>/dev/null || true; wait' INT TERM

wait
