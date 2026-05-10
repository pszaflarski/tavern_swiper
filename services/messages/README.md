# Messages Service Boundary

The Messages boundary is the **end of the event pipeline**. It receives match events from the Discovery boundary and uses them to gate conversation creation — two profiles can only message each other if a verified match exists.

## Position in the System

```
┌───────────────────┐                           ┌──────────────────────────────────┐
│ Discovery Boundary│  Pub/Sub (match events)    │       Messages Boundary          │
│   discovery_go    │ ─────────────────────────→ │                                  │
│   :8003           │  topic: {env}-discovery-    │  ┌──────────────────────────┐    │
└───────────────────┘  match-events-v1            │  │ messages_subscriber      │    │
                                                  │  │ writes to:               │    │
  Match created when                              │  │ discovery_matches_cache   │    │
  two profiles swipe                              │  └───────────┬──────────────┘    │
  RIGHT on each other                             │              │ verifies          │
                                                  │  ┌───────────┴──────────────┐    │
  ┌──────────┐  conversations/messages            │  │ messages_go  :8005       │    │
  │ Frontend │ ←─────────────────────────────────→│  │ owns: conversations,     │    │
  └──────────┘                                    │  │   messages (sub-coll),   │    │
                                                  │  │   profile_conversations  │    │
                                                  │  └──────────────────────────┘    │
                                                  └──────────────────────────────────┘
```

## Containers

### `messages_go` — Messages API

Manages conversations and messages between matched profiles. **Conversations are gated by match verification** — two profiles can only start a conversation if a mutual match exists in the local `discovery_matches_cache`.

- **Port**: `8005`
- **Base path**: `/messages`
- **Database**: `messages-{env}`
- **Key endpoints**:
  - `POST /messages/conversations` — Create a 1-on-1 conversation (idempotent; requires valid match in `discovery_matches_cache`)
  - `GET /messages/conversations/profile/{profile_id}` — List all conversations for a profile, sorted by most recent activity
  - `POST /messages/conversations/{id}/messages` — Send a message (sender must be a participant)
  - `GET /messages/conversations/{id}/messages` — Get all messages in a conversation, ordered by creation time
  - `DELETE /messages/` — Purge all conversations, messages, and mappings (Admin+ only)

### `messages_subscriber` — Match Event Subscriber

Listens for match events published by the **Discovery boundary** via Pub/Sub and maintains a local `discovery_matches_cache` collection. This allows the messages service to verify that a match exists **without querying the discovery service at runtime**.

- **Port**: `8008`
- **Subscribes to**: `{env}-discovery-match-events-v1` topic (published by `discovery_go`)
- **Handles events**:
  - `CREATED` — Cache a new match (match_id, profile_ids, timestamps)
  - `DELETED` — Remove a match from the local cache
- **Protocol**: Protobuf (`proto/match_events.proto`)

## Cross-Service Dependencies

### This boundary receives from:
| Source | What | Mechanism |
|--------|------|-----------|
| **Discovery boundary** (`discovery_go`) | Match data (match_id, profile_ids) | Pub/Sub events on `{env}-discovery-match-events-v1` → `messages_subscriber` writes to `discovery_matches_cache` |

### This boundary provides to:
| Consumer | What | Mechanism |
|----------|------|-----------|
| **Frontend** | Conversations, messages | Direct API calls to `messages_go` |

### This boundary depends on:
| Dependency | What For | How |
|-----------|---------|-----|
| **Auth boundary** | JWT verification | Local JWT check via shared `JWT_SECRET` (no network call) |

## Data Model

**Database**: `messages-{env}`

### Collection: `conversations`
| Field | Type | Description |
|-------|------|-------------|
| `participants` | array | Both profile IDs |
| `participants_key` | string | Deterministic: `{sorted_pid1}_{sorted_pid2}` (deduplication) |
| `match_id` | string | Discovery match ID that authorized this conversation |
| `last_message_content` | string | Denormalized preview |
| `last_message_at` | timestamp | For sort ordering |
| `last_message_sender_id` | string | Profile ID of last sender |
| `created_at` | timestamp | Server-side timestamp |

### Sub-collection: `conversations/{id}/messages`
| Field | Type | Description |
|-------|------|-------------|
| `content` | string | Message text |
| `sender_profile_id` | string | Sending profile ID |
| `created_at` | timestamp | Server-side timestamp |

### Collection: `profile_conversations`
Lookup index for efficient per-profile conversation listing. Document ID: `{profile_id}_{conversation_id}`.

| Field | Type | Description |
|-------|------|-------------|
| `profile_id` | string | Profile ID |
| `conversation_id` | string | Parent conversation ID |
| `other_profile_id` | string | The other participant |
| `last_message_at` | timestamp | Denormalized for sorting |

### Collection: `discovery_matches_cache` (populated by `messages_subscriber`)
| Field | Type | Description |
|-------|------|-------------|
| Document ID | string | Match ID from discovery service |
| `profiles` | array | Both matched profile IDs |
| `created_at` | timestamp | Match creation time |

## Event Flow

```
Discovery Service → Pub/Sub (match events) → Messages Subscriber → Firestore (discovery_matches_cache)
                                                                          ↑
Messages API (create conversation) verifies match from ──────────────────┘
```

### Conversation Creation Logic
1. Validate both profile IDs are provided
2. Build deterministic `participants_key` from sorted profile IDs
3. Check for existing conversation with same `participants_key` (idempotent)
4. Look up match in `discovery_matches_cache` — **reject if no match exists**
5. Create conversation doc + `profile_conversations` index entries in a batch write

## Running

### With Docker Compose
```bash
docker compose up messages messages-subscriber
```

### With Air (hot-reload)
```bash
cd services/messages/messages_go && air
cd services/messages/messages_subscriber && air
```

## Testing
```bash
# messages_go
cd services/messages/messages_go && go test -v ./...

# messages_subscriber
cd services/messages/messages_subscriber && go test -v ./...
```

## Tech Stack
- **Language**: Go (Gin + CORS)
- **Auth**: JWT middleware (Tavern JWT, local verification)
- **Database**: Firestore `messages-{env}` (conversations, messages sub-collections, profile_conversations, discovery_matches_cache)
- **Events**: Pub/Sub + Protobuf (consumes match events from discovery)
- **Docs**: Swagger UI at `/messages/swagger/`
- **Deployment**: Cloud Run via Cloud Build
