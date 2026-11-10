# Feature Specification: Persistent Database Service in a Separate Container

**Feature Branch**: `003-containerized-database`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "put an Database to run in another docker"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Data Survives Restarts (Priority: P1)

As a user of the e-commerce API, I want products and payments to remain available after the stack is restarted so that I do not lose catalog and transaction data every time the environment stops.

**Why this priority**: This is the core outcome of introducing a database. The current in-memory stores discard everything on restart, which makes the system unsuitable for realistic use.

**Independent Test**: Create products and a completed payment, restart or stop/start the stack, then retrieve the same records with identical values. Repeat the restart cycle at least three times.

**Acceptance Scenarios**:

1. **Given** I have created several products, **When** the stack is restarted, **Then** all products are still returned by `GET /api/products` with the same IDs, prices, and stock quantities.
2. **Given** I have completed a payment, **When** the stack is restarted, **Then** `GET /api/payments/:id` still returns that payment with its final status and details.
3. **Given** the stack has been stopped and started repeatedly, **When** I query the catalog, **Then** no duplicates or missing records appear.
4. **Given** the database container is restarted independently, **When** it becomes healthy again, **Then** the services reconnect and serve the same data.

---

### User Story 2 - Existing API Behavior Is Preserved (Priority: P1)

As an API consumer, I want every product and payment operation to behave exactly as before so that adding storage does not break existing clients or scripts.

**Why this priority**: The database must be an implementation change, not an API change. Regression here would invalidate the migration.

**Independent Test**: Run the existing smoke test and isolation scripts unchanged against the new stack; all checks must pass.

**Acceptance Scenarios**:

1. **Given** the stack is running, **When** I perform product create, list, read, update, and delete through the gateway, **Then** the same status codes and payload shapes are returned.
2. **Given** a valid payment, **When** it completes, **Then** the product stock is decremented and the payment is marked completed exactly as before.
3. **Given** an invalid or missing product, **When** I request it, **Then** the same `404` error shape is returned.
4. **Given** the product service is unavailable, **When** a payment is attempted, **Then** the existing explicit `503` behavior is preserved and no stock is changed.

---

### User Story 3 - Isolated Database Service (Priority: P2)

As an operator, I want the database to run in its own container on the private network so that it is not exposed to the host and only the services can reach it.

**Why this priority**: Running a database alongside application code or exposing it publicly would undermine the isolation already established for the stack.

**Independent Test**: Confirm the database container is separate from all application containers, is healthy, is reachable by the services, and is not reachable from the host.

**Acceptance Scenarios**:

1. **Given** the stack is running, **When** I list the stack containers, **Then** the database appears as its own service with a healthy status.
2. **Given** the stack is running, **When** I attempt to connect to the database port from the host, **Then** the connection is refused under the default configuration.
3. **Given** the stack is running, **When** a service reads or writes data, **Then** it reaches the database over the internal network using configuration rather than a hardcoded host address.
4. **Given** the database is not yet ready, **When** the stack starts, **Then** application services wait for database readiness before serving traffic.

---

### User Story 4 - Controlled Reset and Fresh Start (Priority: P3)

As an operator or tester, I want a documented way to intentionally clear all data so that I can return the system to a clean state without guessing which volumes or containers to remove.

**Why this priority**: Persistence changes the reset behavior. Testers and developers need an explicit, predictable reset rather than relying on container restarts.

**Independent Test**: Populate data, run the documented reset procedure, restart the stack, and confirm the API returns empty collections.

**Acceptance Scenarios**:

1. **Given** products and payments exist, **When** I run the documented reset procedure, **Then** the stack restarts with an empty catalog and no payments.
2. **Given** a fresh environment with no stored data, **When** the stack starts, **Then** schema initialization happens automatically with no manual database steps.
3. **Given** I only restart the stack without the reset procedure, **When** it comes back, **Then** previously stored data is still present.

---

### Edge Cases

- **Database unavailable during startup**: Application services must wait or retry, then fail with a clear message rather than crashing in a loop or silently serving unpersisted data.
- **Database becomes unavailable while serving requests**: Requests must return a clear service-unavailable response; payments must not be reported as completed if their stock update could not be persisted.
- **Concurrent purchases of the last unit**: The system must not sell below zero stock or record contradictory payment/stock states.
- **Schema initialization runs twice**: Startup on an existing database must be idempotent and must not wipe or duplicate data.
- **Database volume is removed or lost**: The system must start cleanly, initialize an empty schema, and document that data loss is expected in that case.
- **Wrong or missing database credentials**: Services must fail with a clear configuration error, and credentials must not appear in logs or images.
- **Port conflicts**: The database must not require a host-published port; if an optional host port is configured, a conflict must be reported clearly.
- **Application containers restart repeatedly**: Reconnection must not create duplicate records or lose committed transactions.
- **Existing in-memory data**: Data present before this feature is not migrated and is expected to be lost on first deployment.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST run the database as a dedicated service in its own container within the existing stack.
- **FR-002**: The database MUST use persistent storage that survives container restarts, service restarts, and a normal stack stop/start cycle.
- **FR-003**: Product records MUST be persisted so that all product fields and identifiers survive restarts.
- **FR-004**: Payment records MUST be persisted so that status, amount, customer information, associated product, and timestamps survive restarts.
- **FR-005**: The system MUST initialize the required data structures automatically on first start with an empty database, without manual steps.
- **FR-006**: Initialization MUST be idempotent and MUST NOT delete or duplicate existing data on subsequent starts.
- **FR-007**: The database MUST NOT be reachable from the host under the default configuration; only application services on the internal network may connect.
- **FR-008**: Database connection details MUST be supplied through runtime configuration so that host names and credentials are not hardcoded into application code or images.
- **FR-009**: Database credentials MUST NOT be baked into images, committed to version control, or printed in logs.
- **FR-010**: Application services MUST wait for database readiness, or retry with bounded backoff, before serving requests.
- **FR-011**: When the database is unavailable, the API MUST return a clear service-unavailable response instead of silently falling back to non-persistent storage.
- **FR-012**: A payment MUST NOT be marked completed unless its corresponding stock decrement is persisted; failures MUST leave consistent state.
- **FR-013**: Concurrent purchases MUST NOT drive stock below zero or produce contradictory payment and stock records.
- **FR-014**: All existing product and payment API routes, payloads, status codes, and error shapes MUST remain unchanged.
- **FR-015**: Product and payment data MUST be accessible only to the service that owns it; services MUST NOT read or write each other's records directly.
- **FR-016**: The database container MUST expose a health signal, and stack startup MUST gate application services on that signal.
- **FR-017**: The database container MUST restart automatically after a crash and reconnect cleanly when healthy.
- **FR-018**: The system MUST provide a documented reset procedure that intentionally removes all persisted data and returns the API to empty collections.
- **FR-019**: Logs and status for the database MUST be available through the same single-command stack interfaces used for the other services.
- **FR-020**: Repository documentation MUST cover persistence behavior, configuration, initialization, reset, backup limitations, and troubleshooting.
- **FR-021**: No automatic demo data or seeding is required; a fresh database MUST start with empty product and payment collections.
- **FR-022**: Data created before this feature in memory MUST NOT be migrated; the first deployment starts with an empty persistent store.

### Key Entities *(include if data involved)*

- **Persisted Product**: The durable form of an existing product, with unique identifier, name, description, price, stock quantity, and creation/update timestamps.
- **Persisted Payment**: The durable form of an existing payment, with unique identifier, amount, currency, status, payment method, associated product reference, customer information, card summary, and creation/processing timestamps.
- **Database Service**: A dedicated container holding the durable store, with configuration, health status, restart behavior, and private network membership.
- **Persistent Volume**: The storage boundary that outlives containers; it survives restarts but is destroyed only by an explicit reset or volume removal.
- **Database Credentials**: Runtime configuration values required by services to connect; never exposed to the host network or stored in images.
- **Reset Procedure**: The documented operation that removes persisted data and returns the system to a clean, empty state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of products and payments created before a restart are retrievable with identical values after at least three consecutive restarts.
- **SC-002**: 100% of existing API contract checks (product CRUD, payment completion, stock decrement, error shapes) pass unchanged after the storage change.
- **SC-003**: A developer can go from a clean checkout to a working, persistent stack in under 5 minutes with no manual database commands.
- **SC-004**: The full stack, including the database, reaches a serving state within 90 seconds on a standard developer laptop.
- **SC-005**: 100% of direct host connection attempts to the database port are refused under the default configuration.
- **SC-006**: No product stock ever falls below zero across at least 20 concurrent purchase attempts on limited stock.
- **SC-007**: A database that is unavailable at startup produces an operator-visible error identifying the database within 30 seconds.
- **SC-008**: The documented reset procedure produces an empty product list and no retrievable payments within 30 seconds.
- **SC-009**: Restarting only the database container does not lose committed data, and services resume serving within 60 seconds.
- **SC-010**: Database logs and health status are retrievable with the same single command used for the other services.

## Assumptions

- A relational database is appropriate for the existing product and payment models; the specific engine is selected during planning (PostgreSQL is the reasonable default for this stack).
- The stack continues to target a single Docker Engine host with Compose v2+; managed database services, replication, clustering, and high availability are out of scope.
- One database container is used, with separate logical ownership for product and payment data so that each service remains responsible for its own records.
- A named persistent volume is acceptable for local development and demonstration; backup, point-in-time recovery, and disaster recovery are out of scope.
- Local development credentials may use documented defaults supplied through environment configuration; these are not production secrets.
- The database port remains internal by default. An optional host-published port for debugging is out of scope.
- Existing in-memory data is not migrated; the first startup with persistence begins empty.
- No sample data or seeding is required beyond the empty schema initialization.
- The existing API gateway remains the only publicly published service.
- Application services continue to use the same external API contract and error semantics.
- The reset procedure is an explicit operator action; ordinary restarts must never clear data.
