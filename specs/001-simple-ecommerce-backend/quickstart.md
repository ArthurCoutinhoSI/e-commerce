# Quickstart: Simple E-commerce Backend

**Feature**: 001-simple-ecommerce-backend  
**Date**: 2026-11-02

## Overview

This is a microservices-based e-commerce backend with:
- **API Gateway** (port 8080) - Entry point for all requests
- **Product Service** (port 3001) - Manages product catalog
- **Payment Service** (port 3002) - Handles payment processing

## Prerequisites

- Node.js 18+ and npm
- TypeScript

## Setup

### 1. Install dependencies for all services

```bash
# API Gateway
cd api-gateway && npm install

# Product Service
cd ../product-service && npm install

# Payment Service
cd ../payment-service && npm install
```

### 2. Start all services

You'll need 3 terminal windows or use a process manager.

**Terminal 1 - Product Service:**
```bash
cd product-service
npm run dev
```

**Terminal 2 - Payment Service:**
```bash
cd payment-service
npm run dev
```

**Terminal 3 - API Gateway:**
```bash
cd api-gateway
npm run dev
```

All services will start on their respective ports.

## Testing the API

The API Gateway is at `http://localhost:8080/api`

### Create a Product

```bash
curl -X POST http://localhost:8080/api/products \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Wireless Mouse",
    "description": "Ergonomic wireless mouse",
    "price": 29.99,
    "stockQuantity": 50
  }'
```

### List all Products

```bash
curl http://localhost:8080/api/products
```

### Get a Product

```bash
curl http://localhost:8080/api/products/{product-id}
```

### Update a Product

```bash
curl -X PUT http://localhost:8080/api/products/{product-id} \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Wireless Mouse Pro",
    "description": "Premium ergonomic wireless mouse",
    "price": 39.99,
    "stockQuantity": 45
  }'
```

### Process a Payment

```bash
curl -X POST http://localhost:8080/api/payments \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 29.99,
    "currency": "USD",
    "paymentMethod": "credit_card",
    "productId": "{product-id}",
    "customerInfo": {
      "name": "Jane Doe",
      "email": "jane@example.com"
    },
    "cardDetails": {
      "number": "4111111111111111",
      "expiryMonth": 12,
      "expiryYear": 2027,
      "cvv": "123"
    }
  }'
```

### Check Payment Status

```bash
curl http://localhost:8080/api/payments/{payment-id}
```

## Testing Payment Scenarios

For mock payments:
- Card number starting with `4111` (Visa test) typically succeeds
- Card number starting with `4000` may fail for testing
- Any valid format will be processed by the mock logic

## Health Checks

```bash
# Product Service
curl http://localhost:3001/health

# Payment Service
curl http://localhost:3002/health

# API Gateway
curl http://localhost:8080/health
```

## Notes

- All data is stored in-memory and will be lost when services restart
- No authentication required
- CORS is enabled for local development
- Services communicate via HTTP
- Stock is automatically decremented on successful payments
- Insufficient stock will result in payment failure
