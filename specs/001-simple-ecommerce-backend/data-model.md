# Data Model: Simple E-commerce Backend with Products and Payments

**Feature**: 001-simple-ecommerce-backend  
**Date**: 2026-11-02

## Entities

### Product
Represents an item available for sale in the catalog.

| Field | Type | Required | Description | Constraints |
|-------|------|----------|-------------|-------------|
| id | string (UUID) | Yes | Unique identifier | Auto-generated |
| name | string | Yes | Product name | Non-empty, max 200 chars |
| description | string | Yes | Product description | Non-empty, max 1000 chars |
| price | number (decimal) | Yes | Price per unit | > 0, max 2 decimal places |
| stockQuantity | number (integer) | Yes | Available inventory | >= 0 |
| createdAt | Date/ISO string | Yes | Creation timestamp | Auto-generated |
| updatedAt | Date/ISO string | Yes | Last update timestamp | Auto-generated/updated |

**Validation Rules:**
- Name must not be empty
- Price must be greater than 0
- Stock quantity must be >= 0 (integer)
- Price should be stored with 2 decimal precision

**State Transitions:**
- Stock can be decreased on successful payment
- Stock cannot go below 0

### Payment
Represents a payment transaction for a purchase.

| Field | Type | Required | Description | Constraints |
|-------|------|----------|-------------|-------------|
| id | string (UUID) | Yes | Transaction ID | Auto-generated |
| amount | number (decimal) | Yes | Payment amount | > 0, must match order total |
| currency | string | Yes | Currency code | Default 'USD', 3 chars |
| status | enum | Yes | Payment status | 'pending' \| 'completed' \| 'failed' \| 'cancelled' |
| paymentMethod | string | Yes | Payment method used | e.g., 'credit_card', 'debit_card' |
| productId | string (UUID) | No | Reference to product | If purchasing single product |
| orderReference | string | No | Order reference ID | For grouped purchases |
| customerInfo | object | No | Customer details | { name, email, etc. } |
| cardDetails | object | No | Card info (masked) | { last4, brand } - never store full card |
| createdAt | Date/ISO string | Yes | Creation timestamp | Auto-generated |
| processedAt | Date/ISO string | No | Processing timestamp | Set when status changes from pending |
| errorMessage | string | No | Error details if failed | Set when status is 'failed' |

**Validation Rules:**
- Amount must be greater than 0
- Status must be valid enum value
- If status is 'failed', errorMessage should be provided
- If status is 'completed', processedAt must be set
- Card details should be masked (only last 4 digits)

**State Transitions:**
1. Created with status 'pending'
2. On processing: either -> 'completed' (with processedAt) or -> 'failed' (with errorMessage and processedAt)
3. Can be cancelled only if pending

## Relationships

- Payment may reference Product (many-to-one conceptually)
- For simplicity, Payment stores productId directly rather than full order entity
- Stock is managed at Product level

## Database Schema (In-Memory)

Since using in-memory storage:
```typescript
// product-service/src/store.ts
const products: Map<string, Product> = new Map();

// payment-service/src/store.ts  
const payments: Map<string, Payment> = new Map();
```

## API Request/Response Examples

### Create Product
**Request:**
```json
{
  "name": "Laptop",
  "description": "High-performance laptop",
  "price": 999.99,
  "stockQuantity": 10
}
```

**Response (201 Created):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Laptop",
  "description": "High-performance laptop",
  "price": 999.99,
  "stockQuantity": 10,
  "createdAt": "2026-11-02T10:00:00Z",
  "updatedAt": "2026-11-02T10:00:00Z"
}
```

### Create Payment
**Request:**
```json
{
  "amount": 999.99,
  "currency": "USD",
  "paymentMethod": "credit_card",
  "productId": "550e8400-e29b-41d4-a716-446655440000",
  "customerInfo": {
    "name": "John Doe",
    "email": "john@example.com"
  },
  "cardDetails": {
    "number": "4111111111111111",
    "expiryMonth": 12,
    "expiryYear": 2027,
    "cvv": "123"
  }
}
```

**Response (201 Created):**
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "amount": 999.99,
  "currency": "USD",
  "status": "pending",
  "paymentMethod": "credit_card",
  "productId": "550e8400-e29b-41d4-a716-446655440000",
  "cardDetails": {
    "last4": "1111",
    "brand": "visa"
  },
  "createdAt": "2026-11-02T10:05:00Z"
}
```
