# Characters Service Boundary

The Characters boundary manages Game Master (GM) character templates, non-player character (NPC) persona catalog definitions, and character media assets in Tavern Swiper.

---

## 1. Architectural Taxonomy & Principles

### Principle 1: Interaction Exclusively Through Explicit Contracts
All client character interactions and catalog management actions use versioned OpenAPI REST contracts (`/characters`). Downstream character events use strongly typed schemas.

### Principle 2: Defined Business Purpose (Bounded Context)
- **Bounded Context**: Game Master character archetypes, NPC persona profiles, character portrait image processing/storage, tag assignment, and AI persona system prompt templates.
- **Domain Invariants**: Characters act as canonical template definitions for quest givers and bot personas; state transitions are validated by role-based permissions.

### Principle 3: Complete Autonomy of Operational Data
- **Autonomous Persistence Engine**: Dedicated Firestore database `characters-{env}` (Collections: `characters`, `tags`) + Cloud Storage bucket (`{env}-characters-images`).
- **Isolation Constraint**: External microservices cannot write to or modify `characters-{env}` directly. All character data retrieval occurs via public REST APIs or published event feeds.

---

## 2. The Three Interfaces (3D Architecture)

| Interface Dimension | Target Access Pattern | Typical Protocols / Formats | Primary Purpose & Container Implementation |
|---|---|---|---|
| **1. Synchronous Operational (OLTP)** | Low-latency character CRUD, image uploads, tag management | REST (OpenAPI / Swagger via Gin) | `characters_go` (:8012) handles character creation, persona updates, GCS portrait uploads, and archetype catalog queries. |
| **2. Analytical Query (OLAP)** | Character popularity scans, archetype usage reports | Materialized Views / Analytical exports | Character analytics modules project character selection rates and demographic usage metrics without operational database load. |
| **3. Asynchronous Streaming (Events)** | Character catalog update propagation | GCP Pub/Sub event streams | Publishes character creation and update notifications for downstream AI prompt caching and quest engine synchronization. |

---

## 3. Position in the System & Topology

```
┌─────────────┐     REST /characters       ┌─────────────────────────────────┐
│  Frontend / │ ─────────────────────────→ │       Characters Boundary       │
│  Admin UI   │ ←───────────────────────── │                                 │
└─────────────┘                            │  ┌───────────────────────────┐  │
                                           │  │ characters_go  :8012      │  │
                                           │  │ owns: characters, tags,   │  │
                                           │  │   media assets in GCS     │  │
                                           │  └─────────────┬─────────────┘  │
                                           └────────────────│────────────────┘
                                                            │
                                                            ▼
                                                   ┌─────────────────┐
                                                   │       GCS       │
                                                   │ (character imgs)│
                                                   └─────────────────┘
```

---

## 4. Physical Containers

### `characters_go` — Characters API (OLTP)
Full character lifecycle management including persona definition, archetype tagging, and GCS portrait uploads.
- **Port**: `8012`
- **Base path**: `/characters`
- **Database**: `characters-{env}`
- **Key endpoints**:
  - `POST /characters/` — Create a new character template (Admin+)
  - `GET /characters/{id}` — Get character details by ID
  - `PUT /characters/{id}` — Update character fields and persona
  - `DELETE /characters/{id}` — Soft/hard delete a character
  - `POST /characters/{id}/image` — Upload character portrait image to GCS
  - `GET /characters/` — List all character catalog templates

---

## 5. Cross-Service Dependencies & Events

### Provided to external services:
| Consumer | What | Mechanism |
|---|---|---|
| **Bots Boundary** | Character persona templates | REST API calls / event feeds |
| **Quests Boundary** | Quest giver character details | REST API calls |
| **Frontend** | Character catalog & images | Direct REST API calls to `characters_go` |

### Dependencies:
| Dependency | What For | How |
|---|---|---|
| **Auth Boundary** | JWT verification | Local verification via `JWT_SECRET` |
| **Google Cloud Storage** | Character media | Direct GCS image uploads |

---

## 6. Data Model

**Database**: `characters-{env}`

### Collection: `characters`
| Field | Type | Description |
|---|---|---|
| `id` | string | Document ID |
| `display_name` | string | Character name |
| `title` | string | Hero title / archetype |
| `bio` | string | Character backstory |
| `image_urls` | array\<string\> | GCS public image URLs |
| `system_prompt` | string | AI persona system prompt |
| `tags` | array\<tag\> | Categorized tags |
| `created_at` | timestamp | Server creation timestamp |
| `updated_at` | timestamp | Server update timestamp |

---

## 7. Running & Testing

### Docker Compose
```bash
docker compose up characters
```

### Air Hot-Reload
```bash
cd services/characters/characters_go && air
```

### Unit Tests
```bash
cd services/characters/characters_go && go test -v ./...
```
