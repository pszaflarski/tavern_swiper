# Messages Service

The Messages service handles real-time messaging between matched profiles in Tavern Swiper. It contains two independently deployed containers: a REST API for conversation and message CRUD, and an event-driven subscriber that caches match data locally.

## Containers

### `messages_go` — Messages API
Manages conversations and messages between matched profiles. Conversations are gated by match verification — two profiles can only start a conversation if a mutual match exists.

- **Port**: `8005`
- **Base path**: `/messages`
- **Key endpoints**:
  - `POST /messages/conversations` — Create a 1-on-1 conversation (requires a valid match between the two profiles; idempotent)
  - `GET /messages/conversations/profile/:profile_id` — List all conversations for a profile, sorted by most recent activity
  - `POST /messages/conversations/:id/messages` — Send a message in a conversation (sender must be a participant; content validated and sanitized)
  - `GET /messages/conversations/:id/messages` — Get all messages in a conversation, ordered by creation time
  - `DELETE /messages/` — Purge all conversations, messages, and mappings (Admin+ only)

### `messages_subscriber` — Match Event Subscriber
Listens for match events via Pub/Sub push and maintains a local `discovery_matches_cache` collection in the Messages Firestore database. This allows the messages service to verify match existence without cross-service queries.

- **Subscribes to**: `discovery-match-events-v1` topic
- **Handles events**:
  - `CREATED` — Cache a new match (match_id, profile_ids, timestamps)
  - `DELETED` — Remove a match from the local cache
- **Protocol**: Protobuf (`MatchEvent`)

## Data Model
- **`conversations`** — Top-level conversation docs with participant info and denormalized last-message fields
- **`conversations/{id}/messages`** — Sub-collection of messages per conversation
- **`profile_conversations`** — Mapping collection for efficient per-profile conversation listing
- **`discovery_matches_cache`** — Local cache of match data from the Discovery service

## Event Flow
```
Discovery Service → Pub/Sub (match events) → Messages Subscriber → Firestore (discovery_matches_cache)
                                                                          ↑
Messages API (create conversation) verifies match from ───────────────────┘
```

## Running

### With Air (hot-reload)

```bash
# messages_go
cd services/messages/messages_go
air

# messages_subscriber
cd services/messages/messages_subscriber
air
```

### With Docker Compose

```bash
# From the repo root — starts messages, subscriber, and all dependencies
docker compose up messages messages-subscriber
```

### Standalone Docker

```bash
# messages_go
docker build -t messages-go ./services/messages/messages_go
docker run -p 8005:8005 messages-go

# messages_subscriber
docker build -t messages-subscriber ./services/messages/messages_subscriber
docker run -p 8008:8080 messages-subscriber
```

## Testing

```bash
# messages_go — unit tests (mocks)
cd services/messages/messages_go
go test ./...

# messages_go — integration tests against real Firestore
go test ./... -run Integration -real-db

# messages_subscriber — unit tests
cd services/messages/messages_subscriber
go test ./...
```

## Tech Stack
- **Language**: Go
- **Framework**: Gin + CORS
- **Auth**: JWT middleware (Tavern JWT)
- **Database**: Firestore (conversations, messages sub-collections, profile_conversations, discovery_matches_cache)
- **Messaging**: Google Cloud Pub/Sub (subscribe to match events)
- **Serialization**: Protocol Buffers
- **Docs**: Swagger UI via swag (`/messages/swagger/`)
- **Deployment**: Cloud Run via Cloud Build
