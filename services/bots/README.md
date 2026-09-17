# Bots Service Boundary

The Bots service boundary powers automated AI bot personas in Tavern Swiper. It manages bot configuration profiles, automated swipe triggers on newly registered profiles, and reactive AI chat replies via the `agent_router` system.

---

## 1. Architectural Taxonomy & Principles

### Principle 1: Interaction Exclusively Through Explicit Contracts
All bot management operations use versioned OpenAPI REST contracts (`/bots`). Downstream event processing relies on versioned Protobuf contracts (`proto/profile_events.proto` and `proto/message_events.proto`).

### Principle 2: Defined Business Purpose (Bounded Context)
- **Bounded Context**: Automated AI bot profile creation, automatic welcome swipe triggers, bot personality behavior configuration, and reactive automated message generation.
- **Domain Invariants**: Bots emulate standard hero profile interactions (swiping & messaging) strictly via event-driven behavior pipelines; bot secrets and prompt context are isolated within the bot boundary.

### Principle 3: Complete Autonomy of Operational Data
- **Autonomous Persistence Engine**: Dedicated Firestore database `bots-{env}` (Collections: `bot_configs`, `swipe_queue`, `chat_sessions`).
- **Isolation Constraint**: The Bots service maintains total isolation. Other microservices cannot access `bots-{env}`. Bots interact with the rest of the system strictly via public APIs or Pub/Sub events.

---

## 2. The Three Interfaces (3D Architecture)

| Interface Dimension | Target Access Pattern | Typical Protocols / Formats | Primary Purpose & Container Implementation |
|---|---|---|---|
| **1. Synchronous Operational (OLTP)** | Bot configuration management, manual bot trigger, persona updates | REST (OpenAPI / Swagger via Gin) | `bots_go` (:8011) manages bot persona definitions, system prompt bindings, and administrative bot controls. |
| **2. Analytical Query (OLAP)** | Bot interaction latency, engagement metrics, message response rates | Materialized Views / Analytical exports | Bot Analytics modules project aggregate bot performance and AI model token consumption for reporting. |
| **3. Asynchronous Streaming (Events)** | Profile welcome swipes, automated AI chat response generation | GCP Pub/Sub (Protobuf schemas) | `bots_subscriber` (:8080) listens to `{env}-profiles-profile-events-v1` (to execute bot welcome swipes) and `{env}-messages-message-events-v1` (to trigger LLM reply generation via `agent_router`). |

---

## 3. Position in the System & Event Flow

```
┌───────────────────┐                           ┌──────────────────────────────────┐
│ Profiles Boundary │  Pub/Sub (profile events)  │          Bots Boundary           │
│   profiles_go     │ ─────────────────────────→ │  ┌────────────────────────────┐  │
└───────────────────┘                            │  │ bots_subscriber            │  │
                                                 │  │  :8080                     │  │
┌───────────────────┐                            │  │ - Welcome swipes on new    │  │
│ Messages Boundary │  Pub/Sub (message events)  │  │   profiles                 │  │
│   messages_go     │ ─────────────────────────→ │  │ - Triggers AI chat replies │  │
└───────────────────┘                            │  └─────────────┬──────────────┘  │
                                                 │                │ calls           │
                                                 │  ┌─────────────┴──────────────┐  │
                                                 │  │ agent_router_python        │  │
                                                 │  │ :8000 (LangGraph AI models)│  │
                                                 │  └────────────────────────────┘  │
                                                 │  ┌────────────────────────────┐  │
                                                 │  │ bots_go  :8011             │  │
                                                 │  │ owns bot_configs & state   │  │
                                                 │  └────────────────────────────┘  │
                                                 └──────────────────────────────────┘
```

---

## 4. Physical Containers

### `bots_go` — Bots API (OLTP)
Manages bot identity definitions, bot configuration rules, and behavior settings.
- **Port**: `8011`
- **Base path**: `/bots`
- **Database**: `bots-{env}`
- **Key endpoints**:
  - `POST /bots/` — Register a new bot profile configuration
  - `GET /bots/` — List all registered bots
  - `GET /bots/{id}` — Get bot configuration details
  - `PUT /bots/{id}` — Update bot configuration (persona, system prompt, active status)
  - `DELETE /bots/{id}` — Deactivate or delete a bot persona

### `bots_subscriber` — Event & AI Reply Handler (Events)
Listens for system events and triggers bot actions asynchronously.
- **Port**: `8080`
- **Subscribes to**:
  - `{env}-profiles-profile-events-v1` — Auto-swipes right on new profiles to jumpstart discovery matches
  - `{env}-messages-message-events-v1` — Detects incoming user messages sent to a bot profile and routes them to `agent_router_python` for AI response generation

---

## 5. Cross-Service Dependencies & Events

### Subscribed Events:
| Event Topic | Source Service | Purpose |
|---|---|---|
| `{env}-profiles-profile-events-v1` | `profiles_go` | Triggers auto-swipe on newly created user profiles |
| `{env}-messages-message-events-v1` | `messages_go` | Triggers LLM response generation when user chats with a bot |

### Downstream Service Calls:
| Target Service | Protocol | Purpose |
|---|---|---|
| `agent_router_python` (:8000) | REST `/invoke` | Solicits LLM agent completion using bot system prompts |
| `messages_go` (:8005) | REST `/messages/conversations/{id}/messages` | Sends generated bot reply back into the conversation |
| `discovery_go` (:8003) | REST `/discovery/swipe/` | Executes bot swipes |

---

## 6. Data Model

**Database**: `bots-{env}`

### Collection: `bot_configs`
| Field | Type | Description |
|---|---|---|
| `bot_id` | string | Document ID / Bot profile ID |
| `display_name` | string | Bot display name |
| `agent_name` | string | Registered agent name in `agent_router` |
| `model_name` | string | Default LLM model name |
| `system_prompt` | string | Bot persona system prompt |
| `is_active` | bool | Active bot status flag |
| `created_at` | timestamp | Server creation timestamp |

---

## 7. Running & Testing

### Docker Compose
```bash
docker compose up bots bots-subscriber
```

### Air Hot-Reload
```bash
cd services/bots/bots_go && air
cd services/bots/bots_subscriber && air
```

### Unit Tests
```bash
cd services/bots/bots_go && go test -v ./...
cd services/bots/bots_subscriber && go test -v ./...
```
