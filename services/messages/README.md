# Messages Service Boundary

The Messages boundary provides match-gated 1-on-1 direct messaging between heroes. It consumes match events from the Discovery boundary to maintain its local match verification cache before authorizing chat creation.

---

## 1. Architectural Taxonomy & Principles

### Principle 1: Interaction Exclusively Through Explicit Contracts
All client chat communications use versioned OpenAPI REST contracts (`/messages`). Cross-boundary match notifications are received over Protobuf event schemas (`proto/match_events.proto`).

### Principle 2: Defined Business Purpose (Bounded Context)
- **Bounded Context**: Conversation lifecycle management, 1-on-1 message exchange, participant authorization verification, and chat history retention.
- **Domain Invariants**: Two profiles can ONLY start a conversation if a verified mutual match exists in the local `discovery_matches_cache`.

### Principle 3: Complete Autonomy of Operational Data
- **Autonomous Persistence Engine**: Dedicated Firestore database `messages-{env}` (Collections: `conversations`, sub-collection `messages`, `profile_conversations`, `discovery_matches_cache`).
- **Isolation Constraint**: The Messages boundary never directly accesses `discovery-{env}` to verify matches. Match verification relies on its own local Pub/Sub subscriber cache.

---

## 2. The Three Interfaces (3D Architecture)

| Interface Dimension | Target Access Pattern | Typical Protocols / Formats | Primary Purpose & Container Implementation |
|---|---|---|---|
| **1. Synchronous Operational (OLTP)** | Low-latency message creation, conversation listing, chat history retrieval | REST (OpenAPI / Swagger via Gin) | `messages_go` (:8005) manages conversations and messages between matched profiles, verifying match status against local cache. |
| **2. Analytical Query (OLAP)** | Message volume aggregation, engagement rates, response time analytics | BigQuery exports / Materialized SQL Views | `messages_analytics` projects read-optimized analytical domain models for chat volume without impacting operational database workloads. |
| **3. Asynchronous Streaming (Events)** | Match cache updates, message activity propagation | GCP Pub/Sub (Protobuf schemas) | `messages_subscriber` (:8008) consumes match events on `{env}-discovery-match-events-v1`. `messages_go` publishes message events to `{env}-messages-message-events-v1`. |

---

## 3. Position in the System & Topology

```
┌───────────────────┐                           ┌──────────────────────────────────┐
│ Discovery Boundary│  Pub/Sub (match events)    │       Messages Boundary          │
│   discovery_go    │ ─────────────────────────→ │                                  │
│   :8003           │  topic: {env}-discovery-    │  ┌──────────────────────────┐    │
└───────────────────┘  match-events-v1            │  │ messages_subscriber      │    │
                                                  │  │ writes to:               │    │
                                                  │  │ discovery_matches_cache   │    │
                                                  │  └───────────┬──────────────┘    │
                                                  │              │ verifies          │
                                                  │  ┌───────────┴──────────────┐    │
  ┌──────────┐  conversations/messages            │  │ messages_go  :8005       │    │
  │ Frontend │ ←─────────────────────────────────→│  │ owns: conversations,     │    │
  └──────────┘                                    │  │   messages (sub-coll),   │    │
                                                  │  │   profile_conversations  │    │
                                                  │  └──────────────────────────┘    │
                                                  └──────────────────────────────────┘
```

---

## 4. Physical Containers

### `messages_go` — Messages API (OLTP)
Manages conversations and messages between matched profiles.
- **Port**: `8005`
- **Base path**: `/messages`
- **Database**: `messages-{env}`
- **Key endpoints**:
  - `POST /messages/conversations` — Create a 1-on-1 conversation (requires match in `discovery_matches_cache`)
  - `GET /messages/conversations/profile/{profile_id}` — List conversations for profile
  - `POST /messages/conversations/{id}/messages` — Send message (publishes message event)
  - `GET /messages/conversations/{id}/messages` — Get conversation message history
  - `DELETE /messages/` — Purge conversations & messages (Admin+)

### `messages_subscriber` — Match Event Subscriber (Events)
Listens for match events published by **Discovery boundary** via Pub/Sub and maintains local `discovery_matches_cache`.
- **Port**: `8008`
- **Subscribes to**: `{env}-discovery-match-events-v1`
- **Handles events**: `CREATED`, `DELETED`
- **Protocol**: Protobuf (`proto/match_events.proto`)

### `messages_analytics` — Analytical Engine (OLAP)
Exposes read-optimized chat and engagement metrics.
- **Path**: `services/messages/messages_analytics`
- **Database Target**: BigQuery / SQL Materialized Views
- **Purpose**: Aggregates conversation longevity, activity frequency, and messaging volume.

---

## 5. Cross-Service Dependencies & Events

### Received from external services:
| Source | What | Mechanism |
|---|---|---|
| **Discovery boundary** (`discovery_go`) | Match creation events | Pub/Sub topic `{env}-discovery-match-events-v1` → `messages_subscriber` |

### Provided to external services:
| Consumer | What | Mechanism |
|---|---|---|
| **Bots boundary** (`bots_subscriber`) | Message events for AI replies | Pub/Sub topic `{env}-messages-message-events-v1` |
| **Notifications boundary** (`notifications_subscriber`) | Push alerts | Pub/Sub topic `{env}-messages-message-events-v1` |
| **Frontend** | Conversations & messages | Direct REST API calls to `messages_go` |

---

## 6. Data Model

**Database**: `messages-{env}`

### Collection: `conversations`
| Field | Type | Description |
|---|---|---|
| `participants` | array | Profile IDs |
| `participants_key` | string | `{sorted_pid1}_{sorted_pid2}` |
| `match_id` | string | Discovery match ID |
| `last_message_content` | string | Denormalized preview |
| `last_message_at` | timestamp | Timestamp for sorting |

### Sub-collection: `conversations/{id}/messages`
| Field | Type | Description |
|---|---|---|
| `content` | string | Text content |
| `sender_profile_id` | string | Sender ID |
| `created_at` | timestamp | Timestamp |

### Collection: `discovery_matches_cache` (Populated by `messages_subscriber`)
| Field | Type | Description |
|---|---|---|
| Document ID | string | Match ID |
| `profiles` | array | Matched profile IDs |
| `created_at` | timestamp | Creation timestamp |

---

## 7. Running & Testing

### Docker Compose
```bash
docker compose up messages messages-subscriber
```

### Air Hot-Reload
```bash
cd services/messages/messages_go && air
cd services/messages/messages_subscriber && air
```

### Unit Tests
```bash
cd services/messages/messages_go && go test -v ./...
cd services/messages/messages_subscriber && go test -v ./...
cd services/messages/messages_analytics && go test -v ./...
```
