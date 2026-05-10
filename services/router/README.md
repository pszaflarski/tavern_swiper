# Router Service Boundary

The Router boundary is the **service discovery registry** for the Tavern Swiper ecosystem. It stores the Cloud Run URLs of all microservices, enabling dynamic environment switching and blue-green/preview deployments without redeploying consumers.

## Position in the System

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

## Containers

### `router_go` — Service Registry API

Single container that manages service URL registration and lookup.

- **Port**: `8010`
- **Base path**: `/router`
- **Database**: `router-{env}`
- **Key endpoints**:
  - `GET /router/health` — Health check
  - `GET /router/services` — List all service URLs for the `default` tag (**public** — used by frontend)
  - `GET /router/services?tag=X` — List all services for a specific tag (e.g., `preview`)
  - `GET /router/services/{service_name}` — Get URL for a single service
  - `GET /router/services/{service_name}?tag=X` — Get URL for a tagged version
  - `PUT /router/services/{service_name}` — Upsert a service route (Admin only)
  - `DELETE /router/services/{service_name}?tag=X` — Delete a service route (Admin only)

## Cross-Service Dependencies

### This boundary provides to:
| Consumer | What | Mechanism |
|----------|------|-----------|
| **Frontend** (`switch_env.sh`) | Service URLs for env switching | `GET /router/services` returns all URLs for a tag |
| **Frontend** (`cloudbuild.yaml`) | Backend URLs injected at build time | Cloud Build queries router during frontend deploy |
| **All Cloud Build pipelines** | Service registration | Each service's `cloudbuild.yaml` calls `PUT /router/services/{name}` after successful deploy |

### This boundary depends on:
| Dependency | What For | How |
|-----------|---------|-----|
| **Auth boundary** | JWT verification (admin endpoints only) | Local JWT check via shared `JWT_SECRET` |

### Who populates the registry?
Each service's `cloudbuild.yaml` has a post-deploy step that registers its own Cloud Run URL with the router:
```bash
# Example from a service's cloudbuild.yaml:
curl -X PUT "https://router-${_ENV_SUFFIX}.a.run.app/router/services/${_SERVICE_NAME}" \
  -H "Authorization: Bearer ${_ADMIN_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"url": "${_SERVICE_URL}"}'
```

## Data Model

**Database**: `router-{env}`

### Collection: `service_routes`
Document ID format: `{service}_{tag}` (e.g., `auth_default`, `profiles_preview`)

| Field | Type | Description |
|-------|------|-------------|
| `service` | string | Service name (e.g., `auth`, `profiles`) |
| `tag` | string | Version/environment tag (e.g., `default`, `preview`) |
| `url` | string | Full Cloud Run URL |
| `created_at` | timestamp | Server-side timestamp |
| `updated_at` | timestamp | Server-side timestamp |

> [!NOTE]
> **Timestamp Behavior**: Due to the idempotent "upsert" strategy, `created_at` is updated on every modification (behaves like `updated_at`). Use these timestamps for auditing last-modified times, not for determining the original registration date.

## Running

### With Docker Compose
```bash
docker compose up router
```

### With Air (hot-reload)
```bash
cd services/router/router_go && air
```

## Testing
```bash
cd services/router/router_go && go test -v ./...
```

## Tech Stack
- **Language**: Go (Gin + CORS)
- **Auth**: JWT middleware (Tavern JWT, local verification)
- **Database**: Firestore `router-{env}` (`service_routes` collection)
- **Docs**: Swagger UI at `/router/swagger/`
- **Deployment**: Cloud Run via Cloud Build
