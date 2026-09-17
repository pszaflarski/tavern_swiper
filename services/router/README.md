# Router Service Boundary

The Router boundary is the **service discovery registry** for the Tavern Swiper ecosystem. It stores the Cloud Run URLs of all microservices, enabling dynamic environment switching and preview deployments without redeploying consumers.

---

## 1. Architectural Taxonomy & Principles

### Principle 1: Interaction Exclusively Through Explicit Contracts
All dynamic URL lookups and route registration calls use versioned OpenAPI REST contracts (`/router`). Service mappings follow explicit JSON schemas.

### Principle 2: Defined Business Purpose (Bounded Context)
- **Bounded Context**: Infrastructure service URL discovery, environment tag resolution (`default`, `preview`), and automated Cloud Run route registration post-deployment.
- **Domain Invariants**: Service route updates (`PUT /router/services/{name}`) are restricted to administrative authorization or automated CI/CD Cloud Build pipelines.

### Principle 3: Complete Autonomy of Operational Data
- **Autonomous Persistence Engine**: Dedicated Firestore database `router-{env}` (Collection: `service_routes`).
- **Isolation Constraint**: The Router boundary maintains absolute data autonomy over `service_routes`. Outside services and clients query endpoint URLs strictly via the REST API.

---

## 2. The Three Interfaces (3D Architecture)

| Interface Dimension | Target Access Pattern | Typical Protocols / Formats | Primary Purpose & Container Implementation |
|---|---|---|---|
| **1. Synchronous Operational (OLTP)** | High-frequency service URL lookups, route registration | REST (OpenAPI / Swagger via Gin) | `router_go` (:8010) serves dynamic service routes to clients (`GET /router/services`) and processes post-deploy updates (`PUT /router/services/{name}`). |
| **2. Analytical Query (OLAP)** | Routing resolution telemetry, deployment frequency reporting | Materialized Views / Analytics | Router analytics modules track service route query latency, client environment distribution, and route update frequency. |
| **3. Asynchronous Streaming (Events)** | Deployment status broadcasts, Cloud Build trigger notifications | GCP Pub/Sub & Webhooks | Publishes deployment status updates whenever microservice URLs are upserted or deleted. |

---

## 3. Position in the System & Topology

```
┌─────────────────────┐                      ┌──────────────────┐
│   Frontend          │    GET /services     │   router_go      │
│   switch_env.sh     │ ──────────────────→  │   :8010          │
│   cloudbuild.yaml   │ ←──────────────────  │                  │
└─────────────────────┘   { auth: url,       │   Firestore:     │
                            profiles: url,    │   service_routes │
                            discovery: url,   └──────────────────┘
                            messages: url,           ↑
                            users: url }             │ PUT /services/:name
                                                     │ (admin-only, via
┌─────────────────────┐                              │  cloudbuild.yaml)
│   Cloud Build       │ ────────────────────────────┘
│   (deploy step)     │  Registers new Cloud Run URL
└─────────────────────┘  after successful deployment
```

---

## 4. Physical Containers

### `router_go` — Service Registry API (OLTP)
Single container managing service URL registration, environment tag lookup, and route removal.
- **Port**: `8010`
- **Base path**: `/router`
- **Database**: `router-{env}`
- **Key endpoints**:
  - `GET /router/health` — Health check
  - `GET /router/services` — List all service URLs for `default` tag (public — used by frontend)
  - `GET /router/services?tag=X` — List services for a specific tag (e.g. `preview`)
  - `GET /router/services/{service_name}` — Get URL for a single service
  - `PUT /router/services/{service_name}` — Upsert a service route (Admin / CI/CD only)
  - `DELETE /router/services/{service_name}?tag=X` — Delete a service route (Admin only)

---

## 5. Cross-Service Dependencies & CI/CD Pipeline

### Provided to external consumers:
| Consumer | What | Mechanism |
|---|---|---|
| **Frontend** (`switch_env.sh`) | Microservice URLs for env switching | `GET /router/services` returns map of service URLs |
| **Cloud Build Pipeline** | Backend URL injection during web build | Dynamic query during deploy |

### Populated by:
Each service's `cloudbuild.yaml` has a post-deploy step that registers its Cloud Run URL:
```bash
curl -X PUT "https://router-${_ENV_SUFFIX}.a.run.app/router/services/${_SERVICE_NAME}" \
  -H "Authorization: Bearer ${_ADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"url": "${_SERVICE_URL}"}'
```

---

## 6. Data Model

**Database**: `router-{env}`

### Collection: `service_routes`
Document ID format: `{service}_{tag}` (e.g., `auth_default`, `profiles_preview`)

| Field | Type | Description |
|---|---|---|
| `service` | string | Service name (e.g., `auth`, `profiles`) |
| `tag` | string | Environment tag (`default`, `preview`) |
| `url` | string | Dynamic Cloud Run URL |
| `created_at` | timestamp | Server creation timestamp |
| `updated_at` | timestamp | Server update timestamp |

---

## 7. Running & Testing

### Docker Compose
```bash
docker compose up router
```

### Air Hot-Reload
```bash
cd services/router/router_go && air
```

### Unit Tests
```bash
cd services/router/router_go && go test -v ./...
```
