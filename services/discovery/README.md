# Discovery Service

The Discovery service powers the swipe-based matchmaking engine for Tavern Swiper. It contains two independently deployed containers: a REST API for feed/swipe/match operations and an event-driven subscriber that keeps its local profile cache in sync.

## Containers

### `discovery_go` — Discovery API
Serves the discovery feed, records swipes, detects mutual matches, and manages match data.

- **Port**: `8003`
- **Base path**: `/discovery`
- **Key endpoints**:
  - `GET /discovery/feed/:profile_id` — Get a curated feed of profiles the user hasn't swiped on (uses Firestore Pipeline for server-side filtering)
  - `POST /discovery/swipe/` — Record a left/right swipe; automatically creates a match on mutual right-swipe
  - `GET /discovery/matches/:id` — Get a specific match by ID
  - `GET /discovery/matches/profile/:profile_id` — List all matches for a profile
  - `DELETE /discovery/all` — Purge all swipes and matches (admin/test use)

### `discovery_subscriber` — Profile Event Subscriber
Listens for profile events via Pub/Sub push and maintains a local `profiles_profiles_cache` collection in the Discovery Firestore database. This keeps the discovery feed data eventually consistent with the Profiles service without cross-service queries at read time.

- **Subscribes to**: `profiles-profile-events-v1` topic
- **Handles events**:
  - `UPSERTED` — Create or update a profile in the local cache
  - `DELETED` — Remove a profile from the local cache
  - `ALL_DELETED` — Admin wipe signal
- **Protocol**: Protobuf (`ProfileEvent`)

## Event Flow
```
Profiles Service → Pub/Sub (profile events) → Discovery Subscriber → Firestore (profiles_profiles_cache)
                                                                          ↑
Discovery API (feed/swipe) reads from ─────────────────────────────────────┘

Discovery API → Pub/Sub (match events) → Messages Subscriber
```

## Running

### With Air (hot-reload)

```bash
# discovery_go
cd services/discovery/discovery_go
air

# discovery_subscriber
cd services/discovery/discovery_subscriber
air
```

### With Docker Compose

```bash
# From the repo root — starts discovery, subscriber, and all dependencies
docker compose up discovery discovery-subscriber
```

### Standalone Docker

```bash
# discovery_go
docker build -t discovery-go ./services/discovery/discovery_go
docker run -p 8003:8003 discovery-go

# discovery_subscriber
docker build -t discovery-subscriber ./services/discovery/discovery_subscriber
docker run -p 8007:8080 discovery-subscriber
```

## Testing

```bash
# discovery_go — unit tests (mocks)
cd services/discovery/discovery_go
go test ./...

# discovery_go — integration tests against real Firestore
go test ./... -run Integration -real-db

# discovery_subscriber — unit tests
cd services/discovery/discovery_subscriber
go test ./...
```

## Tech Stack
- **Language**: Go
- **Framework**: Gin + CORS
- **Auth**: JWT middleware (Tavern JWT)
- **Database**: Firestore (`swipes`, `matches`, `profiles_profiles_cache` collections)
- **Messaging**: Google Cloud Pub/Sub (publish match events, subscribe to profile events)
- **Serialization**: Protocol Buffers
- **Docs**: Swagger UI via swag (`/discovery/swagger/`)
- **Deployment**: Cloud Run via Cloud Build
