# e-commerce

Microservices architecture for e-commerce with an API Gateway centralizing traffic routing to the Product and Order services.

## Architecture

This project follows a microservices architecture with:
- **API Gateway** (Port 8080) - Central entry point, routes requests to services
- **Product Service** (Port 3001) - Manages product catalog and inventory
- **Payment Service** (Port 3002) - Handles payment processing

## Features

- Product CRUD operations (Create, Read, Update, Delete)
- Product catalog browsing
- Stock/inventory tracking
- Payment processing with mock gateway
- Prevention of overselling
- RESTful API design

## Quick Start

1. Install dependencies for all services:
```bash
cd api-gateway && npm install
cd ../product-service && npm install
cd ../payment-service && npm install
```

2. Start all services:
```bash
./start-all.sh
```

Or start them individually in separate terminals.

3. Access the API through the gateway at `http://localhost:8080/api`

## API Endpoints

### Products
- `GET /api/products` - List all products
- `GET /api/products/:id` - Get product details
- `POST /api/products` - Create a product
- `PUT /api/products/:id` - Update a product
- `DELETE /api/products/:id` - Delete a product

### Payments
- `POST /api/payments` - Initiate a payment
- `GET /api/payments/:id` - Get payment status

See [specs/001-simple-ecommerce-backend/quickstart.md](specs/001-simple-ecommerce-backend/quickstart.md) for detailed usage examples.

## Documentation

- [Feature Specification](specs/001-simple-ecommerce-backend/spec.md)
- [Implementation Plan](specs/001-simple-ecommerce-backend/plan.md)
- [API Contracts](specs/001-simple-ecommerce-backend/contracts/openapi.yaml)
- [Data Model](specs/001-simple-ecommerce-backend/data-model.md)
- [Quickstart Guide](specs/001-simple-ecommerce-backend/quickstart.md)
