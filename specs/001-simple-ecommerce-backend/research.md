# Research: Simple E-commerce Backend with Products and Payments

**Feature**: 001-simple-ecommerce-backend  
**Date**: 2026-11-02

## Technology Stack Decisions

### Language & Runtime
**Decision**: TypeScript with Node.js  
**Rationale**: Common for microservices, good ecosystem, works well with REST APIs, and there may be existing patterns. Also .opencode has Node setup.  
**Alternatives considered**: Python/FastAPI, Go, Java/Spring Boot

### Web Framework
**Decision**: Express.js  
**Rationale**: Lightweight, simple, widely used, easy to understand for educational projects  
**Alternatives considered**: Fastify, Koa, NestJS

### Data Storage
**Decision**: In-memory storage (arrays/objects) for simplicity  
**Rationale**: No database setup needed, fast to implement, perfect for simple educational project. Data persists during runtime.  
**Alternatives considered**: SQLite, PostgreSQL, MongoDB - but adds complexity not necessary

### API Design
**Decision**: RESTful JSON API  
**Rationale**: Standard, well-understood, matches requirements  
**Alternatives considered**: GraphQL, gRPC

### Payment Processing
**Decision**: Mock/simulated payment processing  
**Rationale**: Requirements say "mock rather than integrating with real payment gateways"  
**Implementation**: Simple logic - validate card details format, randomly succeed/fail or based on test cases, generate transaction IDs

### Service Communication
**Decision**: HTTP REST calls between services, or direct calls for simplicity in monorepo  
**Rationale**: For microservices architecture as described, services can communicate via HTTP. For simplicity in development, can also use in-process calls or just structure as separate services.

### Project Structure
**Decision**: Follow microservices as mentioned in README - API Gateway, Product Service, Payment Service (or Order Service)  
**Rationale**: Matches the stated architecture

## API Endpoints Design

### Product Service
- `GET /products` - List all products
- `GET /products/:id` - Get product by ID
- `POST /products` - Create product
- `PUT /products/:id` - Update product
- `DELETE /products/:id` - Delete product
- `PATCH /products/:id/stock` - Update stock (internal use)

### Payment Service
- `POST /payments` - Initiate payment
- `GET /payments/:id` - Get payment status/details
- `POST /payments/:id/process` - Process/confirm payment

### API Gateway
- Routes requests to appropriate services
- `GET /api/products/*` -> Product Service
- `POST /api/payments/*` -> Payment Service

## Data Models

### Product
```typescript
{
  id: string (uuid),
  name: string,
  description: string,
  price: number (decimal),
  stockQuantity: number,
  createdAt: Date,
  updatedAt: Date
}
```

### Payment
```typescript
{
  id: string (transaction id),
  amount: number,
  currency: string,
  status: 'pending' | 'completed' | 'failed' | 'cancelled',
  paymentMethod: string,
  productId?: string,
  orderReference?: string,
  customerInfo?: object,
  createdAt: Date,
  processedAt?: Date,
  errorMessage?: string
}
```

## Implementation Notes

- Use UUIDs for IDs
- Validate all inputs
- Return proper HTTP status codes (200, 201, 400, 404, 422, 500)
- Handle errors consistently
- For stock management: check stock before processing payment, decrement on successful payment
- For mock payments: simulate 90% success rate or allow test cards to control outcome
- Each service runs on different port
- API Gateway on main port

## Dependencies
Each service will need:
- express
- cors
- uuid
- @types/express, @types/node, typescript (dev)
- ts-node or nodemon for development
- dotenv (optional)
