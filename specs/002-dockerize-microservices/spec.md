# Feature Specification: Containerized E-commerce Microservices Stack

**Feature Branch**: `002-dockerize-microservices`

**Created**: 2026-11-10

**Status**: Draft

**Input**: User description: "i wanna put the microsservices and the api-gaateway to work, i already have dockerengine installed"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One-Command Startup of the Full Stack (Priority: P1)

As a developer or operator, I want to start the API gateway, product service, and payment service together with a single documented command so that I can run the complete e-commerce backend without manually installing dependencies or opening multiple terminals.

**Why this priority**: The current workflow requires Node.js and npm on the host plus manually starting each service. A single-command startup is the core outcome requested and removes the biggest barrier to running the system.

**Independent Test**: On a machine with only the container runtime installed (no Node.js or npm), run the documented startup command from a clean checkout and confirm that the API gateway responds on its public port.

**Acceptance Scenarios**:

1. **Given** a clean checkout of the repository and only the container runtime installed, **When** the startup command is run, **Then** all three services start and the API gateway becomes reachable at `http://localhost:8080`.
2. **Given** the stack is already running, **When** the startup command is run again, **Then** the command completes without duplicate containers or port conflicts, or reports a clear actionable message.
3. **Given** the stack is running, **When** the shutdown command is run, **Then** all related containers and the shared network are removed and the host ports are released.

---

### User Story 2 - Unchanged API Access Through the Gateway (Priority: P1)

As a customer or API consumer, I want to keep using the same gateway URLs for products and payments so that containerization does not change how I interact with the system.

**Why this priority**: The migration must preserve every existing behavior. If routes break, the system is not "working" even if containers start successfully.

**Independent Test**: Execute the documented product and payment flows exclusively through the gateway on port 8080 and verify identical request/response behavior to the current local setup.

**Acceptance Scenarios**:

1. **Given** the stack is running, **When** I request `GET /api/products`, **Then** I receive the product catalog from the product service.
2. **Given** the stack is running, **When** I create, update, and delete a product through `/api/products`, **Then** each operation succeeds with the same status codes and payloads as before.
3. **Given** the stack is running, **When** I create a payment through `POST /api/payments`, **Then** the payment service can validate stock against the product service and the payment flow completes.
4. **Given** the stack is running, **When** I call an unknown route through the gateway, **Then** I receive the existing not-found response.

---

### User Story 3 - Internal Service Isolation and Discovery (Priority: P2)

As an operator, I want the backend services to communicate over an isolated internal network so that only the gateway is exposed to the host and services address each other by name instead of localhost.

**Why this priority**: Running containers with hardcoded `localhost` targets fails because each container has its own network namespace. Correct service-to-service routing is required for payments to validate and decrement stock.

**Independent Test**: From the host, attempt to reach the product and payment service ports directly and confirm they are not published; then verify payment-to-product communication still works through the internal network.

**Acceptance Scenarios**:

1. **Given** the stack is running, **When** I access the product or payment service port directly from the host, **Then** the connection is refused because only the gateway is published.
2. **Given** the stack is running, **When** the gateway proxies a request to a service, **Then** it resolves the service by its internal name rather than a fixed host address.
3. **Given** the stack is running, **When** the payment service checks or decrements product stock, **Then** it reaches the product service over the internal network and the operation succeeds.

---

### User Story 4 - Operational Visibility and Clean Recovery (Priority: P3)

As an operator, I want to check service health and read aggregated logs, and I want the stack to recover cleanly from restarts so that I can diagnose problems without inspecting each container manually.

**Why this priority**: Once the stack runs, day-to-day usability depends on knowing whether services are healthy, seeing failures quickly, and restarting without leftover state.

**Independent Test**: Stop and restart the stack, read logs from all services with one command, and confirm each service reports a healthy status and accepts traffic afterward.

**Acceptance Scenarios**:

1. **Given** the stack is starting, **When** I check service health, **Then** each service reports whether it is ready.
2. **Given** a service fails to start, **When** I inspect the stack status and logs, **Then** the failing service is identifiable with a clear error message.
3. **Given** the stack was stopped and started again, **When** I query the API, **Then** the system is fully functional with fresh state.
4. **Given** the stack is running, **When** a container is restarted automatically after a failure, **Then** it rejoins the network and resumes serving traffic.

---

### Edge Cases

- **Port 8080 already in use**: Startup must fail with a clear message identifying the conflicting port instead of silently leaving a partially started stack.
- **Container orchestration tooling unavailable**: If the orchestration command is missing, the documentation must state the prerequisite and the command must fail with an actionable message.
- **Service starts before its dependency is ready**: The gateway or payment service must tolerate a temporarily unavailable dependency, retry, or wait for readiness rather than crash permanently.
- **Product service unavailable during a payment**: The payment request must return a clear, non-crashing error and must not report success.
- **Restart wipes in-memory data**: Products and payments are lost on restart; this must be explicitly documented as expected behavior.
- **Port or service name collision with another local stack**: The stack must use scoped names so it does not collide with unrelated containers.
- **Host architecture differs (amd64/arm64)**: Images must build and run on the host architecture without manual changes.
- **No network access during build**: The build must fail with a clear dependency-fetch error rather than producing a broken image.
- **Existing local `node_modules` directories**: Build output must not depend on host-installed modules or include development-only dependencies.
- **Abrupt termination**: Stopping the stack must not leave orphaned processes, containers, or networks behind.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a reproducible container image definition for each of the three services: API gateway, product service, and payment service.
- **FR-002**: The system MUST provide a single documented command that builds and starts all three services as one stack.
- **FR-003**: The system MUST provide a single documented command that stops and removes all stack resources, including containers and the shared network.
- **FR-004**: The API gateway MUST be the only service published to the host, on port 8080.
- **FR-005**: The product and payment services MUST NOT be reachable directly from the host by default.
- **FR-006**: The gateway MUST resolve and forward `/api/products` and `/api/payments` to the corresponding services over an internal network, without relying on `localhost`.
- **FR-007**: The payment service MUST resolve the product service over the internal network for stock validation and stock decrement operations.
- **FR-008**: Service locations and ports MUST be configurable through environment settings so that host names are not hardcoded into application code or images.
- **FR-009**: Container images MUST run the compiled application in production mode, not the development file-watcher process.
- **FR-010**: Container images MUST NOT include development-only dependencies or rely on host-installed dependencies.
- **FR-011**: Each service MUST expose a health endpoint that reports readiness, and the stack MUST use these checks to determine service status.
- **FR-012**: Startup MUST NOT report success until the stack's services are running; failures MUST produce a clear, actionable error message.
- **FR-013**: Services MUST tolerate transient unavailability of their dependencies during startup and during requests, using retries or readiness gating.
- **FR-014**: Logs from all services MUST be retrievable with a single documented command.
- **FR-015**: Running the stack MUST require only the container runtime and its orchestration tooling on the host, with no local Node.js or npm installation.
- **FR-016**: The stack MUST use scoped resource names to avoid collisions with unrelated containers, networks, or projects on the same host.
- **FR-017**: The stack MUST release all host ports, containers, and networks on shutdown, leaving no orphaned resources.
- **FR-018**: In-memory product and payment data MUST reset when the stack is restarted, and this behavior MUST be documented.
- **FR-019**: All existing API routes, request payloads, response payloads, and status codes MUST remain unchanged when accessed through the gateway.
- **FR-020**: The repository documentation MUST describe prerequisites, startup, shutdown, health checks, log access, rebuild, and troubleshooting steps for the containerized stack.

### Key Entities *(include if data involved)*

- **Service Container**: A runnable unit for one service (gateway, product, or payment) with its image definition, environment configuration, exposed port, health check, and restart behavior.
- **Internal Network**: The private communication boundary shared by the three services; only the gateway is attached to a host-published port.
- **Runtime Configuration**: Environment-driven values including service ports, service-to-service base URLs, and the gateway public port.
- **Health Status**: The readiness signal exposed by each service and consumed by the orchestration layer and operators.
- **Stack Lifecycle**: The set of operations to build, start, inspect, stop, and rebuild the stack while preserving API behavior.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer on a machine with only the container runtime and its orchestration tooling can go from a clean checkout to a working gateway in under 5 minutes.
- **SC-002**: 100% of the API endpoints documented in the existing feature specification work unchanged through the gateway after containerization.
- **SC-003**: The full stack reaches a serving state within 60 seconds on a standard developer laptop.
- **SC-004**: No application language runtime or package manager installation is required on the host to run the stack.
- **SC-005**: Direct host access to product and payment service ports is refused in 100% of attempts under the default configuration.
- **SC-006**: An end-to-end payment flow through the gateway, including stock validation and decrement, completes in under 5 seconds.
- **SC-007**: Repeated start/stop cycles leave no orphaned containers, networks, or occupied ports.
- **SC-008**: Every startup failure produces an operator-visible message that identifies the failing service or conflicting resource within 30 seconds.
- **SC-009**: Service readiness can be determined by an operator within 10 seconds of stack startup.
- **SC-010**: Logs for all three services can be retrieved with one documented command.

## Assumptions

- Docker Engine is installed on the host, and the Compose v2 plugin is available (commonly bundled with modern Docker Engine). If Compose is absent, installing it is an accepted prerequisite.
- Images are built locally and pulled/published from no private registry; publishing to a registry and CI pipelines are out of scope.
- The host is a Linux workstation on amd64; multi-architecture publishing is out of scope, though images should build on arm64 hosts.
- Product and payment storage remains in-memory for this feature. Persistent volumes, external databases, and data migration are out of scope.
- Authentication, authorization, TLS termination, and rate limiting remain out of scope, consistent with the existing system.
- Production-style builds (compiled output) are required; live reload inside containers is not required.
- The gateway publishes host port 8080, while product and payment service ports remain internal unless an operator explicitly overrides configuration for debugging.
- Internet access is available during image builds to fetch the base image and application dependencies.
- The existing local, non-containerized `start-all.sh` workflow may remain as a development alternative, but the containerized stack becomes the documented primary way to run the system.
- Cloud deployment, Kubernetes, and production infrastructure provisioning are out of scope.
