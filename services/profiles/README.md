# Profiles Service Boundary

The Profiles boundary is the **source of truth** for all hero identity data in Tavern Swiper. It manages profile CRUD, image uploads, tags, and publishes profile events that downstream services consume to build their local caches.

## Position in the System

```
                                                    ┌─────────────────────────┐
                                                    │   Discovery Boundary    │
                                                    │                         │
┌──────────┐    CRUD     ┌──────────────┐  Pub/Sub  │  ┌───────────────────┐  │
│ Frontend │ ──────────→ │ profiles_go  │ ────────→ │  │ discovery_sub     │  │
│          │ ←────────── │    :8002     │  profile   │  │ writes to:        │  │
└──────────┘             │              │  events    │  │ profiles_profiles │  │
                         │  publishes:  │            │  │ _cache            │  │
                         │  UPSERTED    │            │  └───────────────────┘  │
                         │  DELETED     │            │           ↑             │
                         │  ALL_DELETED │            │  discovery_go reads     │
                         └──────────────┘            │  feed from cache        │
                               │                     └─────────────────────────┘
                               │
                         ┌─────┴─────┐
                         │   GCS     │
                         │  (images) │
                         └───────────┘
```

**Profiles is the upstream publisher.** When a profile is created, updated, or deleted, it fires a Protobuf event through Pub/Sub. The Discovery boundary's subscriber consumes these events to keep its local profile cache fresh — so the discovery feed never needs to call the Profiles API at read time.

## Containers

### `profiles_go` — Profiles API

Full profile lifecycle management including creation, updates, image uploads with server-side JPEG normalization, active profile toggling, and a tag management system.

- **Port**: `8002`
- **Base path**: `/profiles`
- **Database**: `profiles-{env}`
- **Key endpoints**:
  - `POST /profiles/` — Create a new profile (auto-sets as active, publishes `UPSERTED` event)
  - `GET /profiles/{id}` — Get a single profile by ID
  - `PUT /profiles/{id}` — Update profile fields (publishes `UPSERTED` event)
  - `DELETE /profiles/{id}` — Delete a profile (publishes `DELETED` event)
  - `POST /profiles/{id}/set_active` — Set as active profile (deactivates all others)
  - `POST /profiles/{id}/image` — Upload portrait image to GCS (JPEG normalization)
  - `GET /profiles/user/me` — List all profiles for current user
  - `GET /profiles/user/me/active` — Get active profile (returns 200 with null body if none)
  - `GET /profiles/user/{user_id}` — List profiles by user ID
  - `POST /profiles/batch` — Batch-fetch profiles by ID list
  - `GET /profiles/all` — List all profiles (Admin+)
  - `DELETE /profiles/` — Purge all profiles (Root Admin, publishes `ALL_DELETED` event)

### Tags System (`/profiles/tags`)

Granular filtering attributes (gender, race, fandom, interests) with admin-managed lifecycle and user suggestions.

- `POST /profiles/tags/` — Create tag (Admin+)
- `GET /profiles/tags/{id}` — Get tag by ID
- `GET /profiles/tags/slug/{slug}` — Get tag by slug
- `GET /profiles/tags/category/{category}` — List tags in category
- `POST /profiles/tags/search` — Case-insensitive prefix search
- `POST /profiles/tags/validate` — Validate tag combinations exist
- `PUT /profiles/tags/{id}` — Update tag (Admin+)
- `DELETE /profiles/tags/{id}` — Delete tag (Admin+)
- `POST /profiles/tags/suggest` — User tag suggestion
- `GET /profiles/tags/suggestions` — List suggestions (Admin+)
- `DELETE /profiles/tags/suggestions/{id}` — Reject suggestion (Admin+)

## Cross-Service Dependencies

### This boundary provides to other services:
| Consumer | What It Provides | Mechanism |
|----------|-----------------|-----------|
| **Discovery boundary** (`discovery_subscriber`) | Profile data for feed | Pub/Sub events on topic `{env}-profiles-profile-events-v1`. Subscriber writes to `profiles_profiles_cache` in discovery DB. |
| **Frontend** | Active profile, batch fetch | Direct API calls |

### This boundary depends on:
| Dependency | What For | How |
|-----------|---------|-----|
| **Auth boundary** | JWT verification | Local JWT check via shared `JWT_SECRET` (no network call) |
| **Google Cloud Storage** | Profile images | Direct GCS upload with public read URLs |
| **Google Cloud Pub/Sub** | Event publishing | Publishes to `{env}-profiles-profile-events-v1` topic |

### Pub/Sub Events Published

All events use **Protobuf** serialization (`proto/profile_events.proto`).

| Event | Trigger | Downstream Effect |
|-------|---------|------------------|
| `UPSERTED` | Profile created, updated, image added, activated/deactivated | `discovery_subscriber` upserts doc in `profiles_profiles_cache` |
| `DELETED` | Profile deleted | `discovery_subscriber` removes doc from cache |
| `ALL_DELETED` | Admin purge | `discovery_subscriber` wipes entire cache collection |

## Data Model

**Database**: `profiles-{env}`

### Collection: `profiles`
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Auto-generated document ID |
| `user_id` | string | Owner's Firebase UID |
| `display_name` | string | Hero name |
| `bio` | string | Hero backstory |
| `image_url` | string | GCS public URL |
| `tags` | array | Denormalized tag objects `{id, name, slug, category}` |
| `is_active` | bool | Whether this is the user's current identity |
| `created_at` | timestamp | Server-side timestamp |
| `updated_at` | timestamp | Server-side timestamp |

### Collection: `tags`
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `slug` | string | URL-safe unique identifier |
| `category` | string | `gender`, `race`, `fandom`, `interest` |
| `status` | string | `approved`, `pending` |
| `created_at` | timestamp | Server-side timestamp |

## Running

### With Docker Compose
```bash
docker compose up profiles
```

### With Air (hot-reload)
```bash
cd services/profiles/profiles_go && air
```

## Testing
```bash
cd services/profiles/profiles_go && go test -v ./...
```

## Tech Stack
- **Language**: Go (Gin + CORS)
- **Auth**: JWT middleware (Tavern JWT, local verification)
- **Database**: Firestore `profiles-{env}` (`profiles`, `tags` collections)
- **Storage**: Google Cloud Storage (JPEG normalization, public read)
- **Events**: Pub/Sub + Protobuf (`{env}-profiles-profile-events-v1`)
- **Docs**: Swagger UI at `/profiles/swagger/`
- **Deployment**: Cloud Run via Cloud Build
