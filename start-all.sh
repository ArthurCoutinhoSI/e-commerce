#!/bin/bash
echo "Starting all services..."

cd /home/debianserver/Documentos/projects/computacao-distribuida/trabalho-pratico/e-commerce

# Start Product Service
cd product-service && npm run dev &
PRODUCT_PID=$!
echo "Product Service started (PID: $PRODUCT_PID)"

# Start Payment Service
cd ../payment-service && npm run dev &
PAYMENT_PID=$!
echo "Payment Service started (PID: $PAYMENT_PID)"

# Start API Gateway
cd ../api-gateway && npm run dev &
GATEWAY_PID=$!
echo "API Gateway started (PID: $GATEWAY_PID)"

echo ""
echo "All services starting..."
echo "API Gateway: http://localhost:8080"
echo "Product Service: http://localhost:3001"
echo "Payment Service: http://localhost:3002"
echo ""
echo "Press Ctrl+C to stop all services"

wait
