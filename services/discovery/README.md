# Discovery Service Boundary

The Discovery boundary powers the swipe-based matchmaking engine for Tavern Swiper. It sits **between** the Profiles and Messages boundaries in the event pipeline: it consumes profile events to build its feed cache, and publishes match events that the Messages boundary consumes.

---

## 1. Architectural Taxonomy & Principles

### Principle 1: Interaction Exclusively Through Explicit Contracts
All feed and swipe actions use versioned OpenAPI REST schemas. Cross-boundary events use versioned Protobuf contracts (`proto/profile_events.proto` and `proto/match_events.proto`).

### Principle 2: Defined Business Purpose (Bounded Context)
- **Bounded Context**: Candidate feed recommendation, directional swiping (`left`/`right`), mutual match detection, match record management, and swipe TTL cleanup.
- **Domain Invariants**: Swipes are unidirectional state transitions; mutual `right` swipes automatically materialize a deterministic match (`match_{sorted_ids}`) and trigger event propagation.

### Principle 3: Complete Autonomy of Operational Data
- **Autonomous Persistence Engine**: Dedicated Firestore database `discovery-{env}` (Collections: `swipes`, `matches`, `profiles_profiles_cache`).
- **Isolation Constraint**: The feed is generated entirely from `profiles_profiles_cache` populated via Pub/Sub. Discovery never queries the Profiles service database.

---

## 2. The Three Interfaces (3D Architecture)

| Interface Dimension | Target Access Pattern | Typical Protocols / Formats | Primary Purpose & Container Implementation |
|---|---|---|---|
| **1. Synchronous Operational (OLTP)** | Feed curation, recording swipes, match detail queries, scheduled TTL cleanup | REST (OpenAPI / Swagger via Gin) | `discovery_go` (:8003) serves the swipe feed and processes swipes. `discovery_worker` (:8014) runs background cleanup routines for expired swipes. |
| **2. Analytical Query (OLAP)** | High-throughput swipe volume scans, match conversion rates, feed latency | BigQuery exports / Materialized SQL Views | `discovery_analytics` exposes analytical domain projections without impacting transactional feed generation or swipe processing. |
| **3. Asynchronous Streaming (Events)** | Profile cache synchronization, match event publishing | GCP Pub/Sub (Protobuf schemas) | `discovery_subscriber` (:8007) consumes profile events on `{env}-profiles-profile-events-v1`. `discovery_go` publishes match events on `{env}-discovery-match-events-v1`. |

---

## 3. Position in the System & Topology

```
┌───────────────────┐                           ┌─────────────────────────────────┐
│ Profiles Boundary │  Pub/Sub (profile events)  │      Discovery Boundary         │
│   profiles_go     │ ─────────────────────────→ │                                 │
│   :8002           │  topic: {env}-profiles-     │  ┌─────────────────────────┐    │
└───────────────────┘  profile-events-v1          │  │ discovery_subscriber    │    │
                                                  │  │ writes to:              │    │
                                                  │  │ profiles_profiles_cache  │    │
                                                  │  └────────────┬────────────┘    │
                                                  │               │ reads           │
                                                  │  ┌────────────┴────────────┐    │
                                                  │  │ discovery_go  :8003     │    │
  ┌──────────┐   feed/swipe/matches               │  │ owns: swipes, matches   │    │
  │ Frontend │ ←─────────────────────────────────→│  │                         │    │
  └──────────┘                                    │  └────────────┬────────────┘    │
                                                  └───────────────│────────────────┘
                                                                  │
                                                   Pub/Sub (match events)
                                                   topic: {env}-discovery-
                                                   match-events-v1
                                                                  │
                                                                  ↓
                                                  ┌───────────────────────────┐
                                                  │   Messages Boundary       │
                                                  │   messages_subscriber     │
                                                  │   writes to:              │
                                                  │   discovery_matches_cache │
                                                  └───────────────────────────┘
```

---

## 4. Physical Containers

### `discovery_go` — Discovery API (OLTP)
Serves the discovery feed, records swipes, detects mutual matches, and manages match data.
- **Port**: `8003`
- **Base path**: `/discovery`
- **Database**: `discovery-{env}`
- **Key endpoints**:
  - `GET /discovery/feed/{profile_id}` — Get curated feed (reads from `profiles_profiles_cache`)
  - `POST /discovery/swipe/` — Record swipe; creates match on mutual right swipe & publishes `match_created` event
  - `GET /discovery/matches/{id}` — Get match by ID
  - `GET /discovery/matches/profile/{profile_id}` — List matches for profile
  - `DELETE /discovery/all` — Purge swipes & matches (admin/test use)

### `discovery_subscriber` — Profile Event Subscriber (Events)
Listens for profile events published by **Profiles boundary** and maintains local `profiles_profiles_cache`.
- **Port**: `8007`
- **Subscribes to**: `{env}-profiles-profile-events-v1`
- **Handles events**: `UPSERTED`, `DELETED`, `ALL_DELETED`
- **Protocol**: Protobuf (`proto/profile_events.proto`)

### `discovery_worker` — Swipe TTL Cleanup Worker (OLTP Background)
Periodically deletes "left" swipes from `swipes` collection after they exceed 24 hours.
- **Port**: `8014`
- **Key endpoints**:
  - `GET /` — Health check
  - `POST /cleanup` — Triggers swipe cleanup query

### `discovery_analytics` — Analytical Engine (OLAP)
Exposes read-optimized swipe metrics and match conversion analytics.
- **Path**: `services/discovery/discovery_analytics`
- **Database Target**: BigQuery / SQL Materialized Views
- **Purpose**: Computes swipe conversion ratios and demographic match rates without transactional database overhead.

---

## 5. Cross-Service Dependencies & Event Flow

### Provided to external services:
| Consumer | What | Mechanism |
|---|---|---|
| **Messages boundary** (`messages_subscriber`) | Match creation events | Pub/Sub topic `{env}-discovery-match-events-v1` |
| **Frontend** | Feed, swipe, match data | Direct REST API calls to `discovery_go` |

### Received from external services:
| Source | What | Mechanism |
|---|---|---|
| **Profiles boundary** (`profiles_go`) | Profile data | Pub/Sub topic `{env}-profiles-profile-events-v1` → `discovery_subscriber` |

---

## 6. Data Model

**Database**: `discovery-{env}`

### Collection: `swipes`
| Field | Type | Description |
|---|---|---|
| `swiper_profile_id` | string | Initiating profile |
| `swiped_profile_id` | string | Target profile |
| `direction` | string | `left` or `right` |
| `created_at` | timestamp | Timestamp |

### Collection: `matches`
| Field | Type | Description |
|---|---|---|
| Document ID | string | Deterministic: `match_{sorted_profile_ids}` |
| `profiles` | array | Matched profile IDs |
| `created_at` | timestamp | Creation timestamp |

### Collection: `profiles_profiles_cache` (Populated by `discovery_subscriber`)
| Field | Type | Description |
|---|---|---|
| Document ID | string | Profile ID |
| `display_name` | string | Display name |
| `tagline` | string | Tagline |
| `bio` | string | Bio |
| `image_urls` | array\<string\> | GCS image URLs |
| `gender`, `race`, `fandom`, etc. | array\<tag\> | Profile tags |

---

## 7. Running & Testing

### Docker Compose
```bash
docker compose up discovery discovery-subscriber discovery-worker
```

### Air Hot-Reload
```bash
cd services/discovery/discovery_go && air
cd services/discovery/discovery_subscriber && air
```

### Unit Tests
```bash
cd services/discovery/discovery_go && go test -v ./...
cd services/discovery/discovery_subscriber && go test -v ./...
cd services/discovery/discovery_analytics && go test -v ./...
```
