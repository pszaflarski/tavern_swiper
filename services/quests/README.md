# Quests Service Boundary

The Quests service boundary manages fantasy quest progression, active quest tracking, checkpoint validation logic, and hero inventory reward distribution in Tavern Swiper.

---

## 1. Architectural Taxonomy & Principles

### Principle 1: Interaction Exclusively Through Explicit Contracts
All client quest actions, checkpoint verification steps, and inventory operations rely on versioned OpenAPI REST contracts (`/quests`). Downstream quest events use strongly typed schemas.

### Principle 2: Defined Business Purpose (Bounded Context)
- **Bounded Context**: Quest template definitions, player quest state progression, checkpoint validation rules, quest reward distribution (inventory items/gold), and active quest tracking.
- **Domain Invariants**: Quest completion requires all ordered checkpoints to be validated in sequence; reward claims are strictly idempotent.

### Principle 3: Complete Autonomy of Operational Data
- **Autonomous Persistence Engine**: Dedicated Firestore database `quests-{env}` (Collections: `quests`, `user_quests`, `inventory`).
- **Isolation Constraint**: External microservices cannot query or write to `quests-{env}` directly. Quest state transitions are strictly governed by `quests_go`.

---

## 2. The Three Interfaces (3D Architecture)

| Interface Dimension | Target Access Pattern | Typical Protocols / Formats | Primary Purpose & Container Implementation |
|---|---|---|---|
| **1. Synchronous Operational (OLTP)** | Low-latency quest discovery, checkpoint progression, item reward collection | REST (OpenAPI / Swagger via Gin) | `quests_go` (:8013) handles quest retrieval, user quest acceptance, checkpoint state updates (`/quests/progress`), and inventory inspection. |
| **2. Analytical Query (OLAP)** | Quest completion rates, item drop statistics, player progression analytics | Materialized Views / Analytical exports | Quest analytics modules project aggregate player progression and quest popularity metrics for game balancing. |
| **3. Asynchronous Streaming (Events)** | Quest completion notifications, reward event distribution | GCP Pub/Sub event streams | Publishes quest completion and item reward events to notify downstream systems (e.g. notifications and bot persona state). |

---

## 3. Position in the System & Topology

```
┌─────────────┐     REST /quests           ┌─────────────────────────────────┐
│   Frontend  │ ─────────────────────────→ │         Quests Boundary         │
│  (Expo App) │ ←───────────────────────── │                                 │
└─────────────┘                            │  ┌───────────────────────────┐  │
                                           │  │ quests_go  :8013          │  │
                                           │  │ owns: quests, user_quests,│  │
                                           │  │   inventory               │  │
                                           │  └───────────────────────────┘  │
                                           └─────────────────────────────────┘
```

---

## 4. Physical Containers

### `quests_go` — Quests API (OLTP)
Manages quest definitions, user quest progress, checkpoint evaluations, and inventory item rewards.
- **Port**: `8013`
- **Base path**: `/quests`
- **Database**: `quests-{env}`
- **Key endpoints**:
  - `GET /quests/` — List all available quest templates
  - `GET /quests/{id}` — Get single quest details
  - `POST /quests/accept/{id}` — Accept a quest for active profile
  - `GET /quests/user/active` — Get active user quests
  - `POST /quests/progress` — Advance quest checkpoint step
  - `GET /quests/inventory` — Inspect user inventory items and rewards

---

## 5. Cross-Service Dependencies & Events

### Provided to external services:
| Consumer | What | Mechanism |
|---|---|---|
| **Frontend** | Quest list, progression state, inventory | Direct REST API calls to `quests_go` |
| **Bots / Agent Router** | Checkpoint validation context | REST API calls / event feeds |

### Dependencies:
| Dependency | What For | How |
|---|---|---|
| **Auth Boundary** | JWT verification | Local verification via `JWT_SECRET` |
| **Profiles Boundary** | Active profile lookup | Inter-service API verification |

---

## 6. Data Model

**Database**: `quests-{env}`

### Collection: `quests`
| Field | Type | Description |
|---|---|---|
| `id` | string | Quest ID |
| `title` | string | Quest title |
| `description` | string | Detailed backstory & objectives |
| `checkpoints` | array | Sequential checkpoint criteria |
| `rewards` | array | Granted inventory items and gold |

### Collection: `user_quests`
| Field | Type | Description |
|---|---|---|
| `user_id` | string | User UID |
| `profile_id` | string | Profile ID |
| `quest_id` | string | Associated quest ID |
| `current_step` | int | Current checkpoint index |
| `status` | string | `active`, `completed`, `failed` |

### Collection: `inventory`
| Field | Type | Description |
|---|---|---|
| `profile_id` | string | Owner profile ID |
| `item_id` | string | Item identifier |
| `quantity` | int | Item count |

---

## 7. Running & Testing

### Docker Compose
```bash
docker compose up quests
```

### Air Hot-Reload
```bash
cd services/quests/quests_go && air
```

### Unit Tests
```bash
cd services/quests/quests_go && go test -v ./...
```
