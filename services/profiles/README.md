# Profiles Service Boundary

The Profiles boundary is the **source of truth** for all hero identity data in Tavern Swiper. It manages profile CRUD, media image uploads, taxonomy tags, and publishes profile event streams to maintain downstream read caches.

---

## 1. Architectural Taxonomy & Principles

### Principle 1: Interaction Exclusively Through Explicit Contracts
All synchronous client interactions use versioned OpenAPI REST contracts (`/profiles`). Downstream cross-boundary integrations rely on versioned Protobuf event schemas (`proto/profile_events.proto`).

### Principle 2: Defined Business Purpose (Bounded Context)
- **Bounded Context**: Hero character profile lifecycle, tagline & bio text, portrait media image processing (JPEG normalization), tag attribution (race, gender, fandom, interests, looking_for), and active identity selection.
- **Domain Invariants**: Each user can have multiple profiles, but only one profile can be marked active (`is_active = true`) at any given time.

### Principle 3: Complete Autonomy of Operational Data
- **Autonomous Persistence Engine**: Dedicated Firestore database `profiles-{env}` (Collections: `profiles`, `tags`) + Cloud Storage bucket (`{env}-profiles-images`).
- **Isolation Constraint**: External services never query `profiles-{env}` or GCS directly. All profile reads for matchmaking or chat rely on local asynchronous event caches.

---

## 2. The Three Interfaces (3D Architecture)

| Interface Dimension | Target Access Pattern | Typical Protocols / Formats | Primary Purpose & Container Implementation |
|---|---|---|---|
| **1. Synchronous Operational (OLTP)** | Low-latency entity CRUD, image uploads, tag management | REST (OpenAPI / Swagger via Gin) | `profiles_go` (:8002) handles profile creation, active profile toggles, image GCS uploads with JPEG normalization, and tag management (`/profiles/tags`). |
| **2. Analytical Query (OLAP)** | Aggregate tag distribution, profile creation rates, hero popularity | BigQuery exports / Materialized SQL Views | `profiles_analytics` projects read-optimized analytical datasets to downstream engines without impacting operational database workloads. |
| **3. Asynchronous Streaming (Events)** | Profile updates, deletion propagation, cross-domain cache updates | GCP Pub/Sub (Protobuf schemas) | Publishes state-change notifications (`UPSERTED`, `DELETED`, `ALL_DELETED`) to topic `{env}-profiles-profile-events-v1`. |

---

## 3. Position in the System & Event Flow

```
                                                    ┌─────────────────────────┐
                                                    │   Discovery Boundary    │
                                                    │                         │
┌──────────┐    CRUD     ┌──────────────┐  Pub/Sub  │  ┌───────────────────┐  │
│ Frontend │ ──────────→ │ profiles_go  │ ────────→ │  │ discovery_sub     │  │
│          │ ←────────── │    :8002     │  profile  │  │ writes to:        │  │
└──────────┘             │              │  events   │  │ profiles_profiles │  │
                         │  publishes:  │           │  │ _cache            │  │
                         │  UPSERTED    │           │  └───────────────────┘  │
                         │  DELETED     │           │           ↑             │
                         │  ALL_DELETED │           │  discovery_go reads     │
                         └──────────────┘           │  feed from cache        │
                                │                   └─────────────────────────┘
                                │
                          ┌─────┴─────┐
                          │   GCS     │
                          │  (images) │
                          └───────────┘
```

**Profiles is the upstream publisher.** When a profile is created, updated, or deleted, it fires a Protobuf event through Pub/Sub. The Discovery boundary's subscriber consumes these events to keep its local profile cache fresh — so the discovery feed never needs to call the Profiles API at read time.

---

## 4. Physical Containers

### `profiles_go` — Profiles API (OLTP)
Full profile lifecycle management including creation, updates, image uploads with server-side JPEG normalization, active profile toggling, and tag management.
- **Port**: `8002`
- **Base path**: `/profiles`
- **Database**: `profiles-{env}`
- **Key endpoints**:
  - `POST /profiles/` — Create profile (auto-sets active, publishes `UPSERTED` event)
  - `GET /profiles/{id}` — Get single profile by ID
  - `PUT /profiles/{id}` — Update profile fields (publishes `UPSERTED` event)
  - `DELETE /profiles/{id}` — Delete profile (publishes `DELETED` event)
  - `POST /profiles/{id}/set_active` — Set active profile (deactivates others)
  - `POST /profiles/{id}/image` — Upload portrait image to GCS (JPEG normalization)
  - `GET /profiles/user/me` — List profiles for current user
  - `GET /profiles/user/me/active` — Get active profile
  - `GET /profiles/user/{user_id}` — List profiles by user ID
  - `POST /profiles/batch` — Batch-fetch profiles by ID list
  - `GET /profiles/all` — List all profiles (Admin+)
  - `DELETE /profiles/` — Purge all profiles (Root Admin, publishes `ALL_DELETED` event)

#### Tags Sub-System (`/profiles/tags`)
- `POST /profiles/tags/` — Create tag (Admin+)
- `GET /profiles/tags/{id}` — Get tag by ID
- `GET /profiles/tags/slug/{slug}` — Get tag by slug
- `GET /profiles/tags/category/{category}` — List tags in category
- `POST /profiles/tags/search` — Case-insensitive search
- `POST /profiles/tags/validate` — Validate tag combinations
- `PUT /profiles/tags/{id}` — Update tag (Admin+)
- `DELETE /profiles/tags/{id}` — Delete tag (Admin+)

### `profiles_analytics` — Analytical Engine (OLAP)
Provides high-throughput read projections for reporting and popularity analytics.
- **Path**: `services/profiles/profiles_analytics`
- **Database Target**: BigQuery / SQL Materialized Views
- **Purpose**: Tracks profile engagement, tag usage trends, and hero demographics without impacting transactional read/write throughput.

---

## 5. Cross-Service Dependencies & Events

### Provided to external services:
| Consumer | What It Provides | Mechanism |
|---|---|---|
| **Discovery boundary** (`discovery_subscriber`) | Profile feed data | Pub/Sub topic `{env}-profiles-profile-events-v1` → writes to `profiles_profiles_cache` |
| **Frontend** | Active profile, batch fetch | Direct REST API calls |

### Dependencies:
| Dependency | What For | How |
|---|---|---|
| **Auth boundary** | JWT verification | Shared `JWT_SECRET` local verification |
| **Google Cloud Storage** | Profile images | Direct GCS upload with public read URLs |
| **Google Cloud Pub/Sub** | Event publishing | Publishes to `{env}-profiles-profile-events-v1` topic |

### Pub/Sub Event Schemas (`proto/profile_events.proto`)
| Event | Trigger | Downstream Effect |
|---|---|---|
| `UPSERTED` | Profile created, updated, image added | `discovery_subscriber` upserts cache document |
| `DELETED` | Profile deleted | `discovery_subscriber` removes cache document |
| `ALL_DELETED` | Admin purge | `discovery_subscriber` wipes cache collection |

---

## 6. Data Model

**Database**: `profiles-{env}`

### Collection: `profiles`
| Field | Type | Description |
|---|---|---|
| `id` | string | Auto-generated document ID |
| `user_id` | string | Owner's Firebase UID |
| `display_name` | string | Hero name |
| `bio` | string | Hero backstory |
| `tagline` | string | Short tagline |
| `image_urls` | array\<string\> | GCS public URLs |
| `gender` | array\<tag\> | Gender tags `{id, name, slug, category, status}` |
| `race` | array\<tag\> | Race tags |
| `fandom` | array\<tag\> | Fandom tags |
| `interests` | array\<tag\> | Interest tags |
| `events` | array\<tag\> | Event tags |
| `looking_for` | array\<tag\> | Looking-for tags |
| `age` | int | Age (optional) |
| `is_oc` | bool | Original character flag |
| `is_active` | bool | Active identity flag |
| `created_at` | timestamp | Creation timestamp |
| `updated_at` | timestamp | Last update timestamp |

### Collection: `tags`
| Field | Type | Description |
|---|---|---|
| `name` | string | Display name |
| `slug` | string | URL-safe identifier |
| `category` | string | Tag category |
| `status` | string | Approval status |
| `created_at` | timestamp | Server-side timestamp |

---

## 7. Running & Testing

### Docker Compose
```bash
docker compose up profiles
```

### Air Hot-Reload
```bash
cd services/profiles/profiles_go && air
```

### Unit Tests
```bash
cd services/profiles/profiles_go && go test -v ./...
cd services/profiles/profiles_analytics && go test -v ./...
```
