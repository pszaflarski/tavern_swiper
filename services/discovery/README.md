# Discovery Service Boundary

The Discovery boundary powers the swipe-based matchmaking engine for Tavern Swiper. It sits **between** the Profiles and Messages boundaries in the event pipeline: it consumes profile events to build its feed cache, and publishes match events that the Messages boundary consumes.

## Position in the System

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

## Containers

### `discovery_go` — Discovery API

Serves the discovery feed, records swipes, detects mutual matches, and manages match data.

- **Port**: `8003`
- **Base path**: `/discovery`
- **Database**: `discovery-{env}`
- **Key endpoints**:
  - `GET /discovery/feed/{profile_id}` — Get a curated feed of profiles the user hasn't swiped on (reads from `profiles_profiles_cache`, uses Firestore Pipeline for server-side filtering)
  - `POST /discovery/swipe/` — Record a left/right swipe; automatically creates a match on mutual right-swipe and publishes `match_created` event
  - `GET /discovery/matches/{id}` — Get a specific match by ID
  - `GET /discovery/matches/profile/{profile_id}` — List all matches for a profile
  - `DELETE /discovery/all` — Purge all swipes and matches (admin/test use)

### `discovery_subscriber` — Profile Event Subscriber

Listens for profile events published by the **Profiles boundary** via Pub/Sub and maintains a local `profiles_profiles_cache` collection. This keeps the discovery feed eventually consistent with profile data **without any cross-service API calls at read time**.

- **Port**: `8007`
- **Subscribes to**: `{env}-profiles-profile-events-v1` topic (published by `profiles_go`)
- **Handles events**:
  - `UPSERTED` — Create or update a profile doc in the local cache
  - `DELETED` — Remove a profile doc from the local cache
  - `ALL_DELETED` — Wipe the entire cache collection (admin purge)
- **Protocol**: Protobuf (`proto/profile_events.proto`)
- **In Docker**: Uses `cmd/local/main.go` with pull-based subscription against Pub/Sub emulator

## Cross-Service Dependencies

### This boundary receives from:
| Source | What | Mechanism |
|--------|------|-----------|
| **Profiles boundary** (`profiles_go`) | Profile data (name, bio, image, tags) | Pub/Sub events on `{env}-profiles-profile-events-v1` → `discovery_subscriber` writes to `profiles_profiles_cache` |

### This boundary provides to:
| Consumer | What | Mechanism |
|----------|------|-----------|
| **Messages boundary** (`messages_subscriber`) | Match data (match_id, profile_ids) | Pub/Sub events on `{env}-discovery-match-events-v1` published by `discovery_go` on mutual swipe |
| **Frontend** | Feed, swipe, match data | Direct API calls to `discovery_go` |

### This boundary depends on:
| Dependency | What For | How |
|-----------|---------|-----|
| **Auth boundary** | JWT verification | Local JWT check via shared `JWT_SECRET` (no network call) |

## Data Model

**Database**: `discovery-{env}`

### Collection: `swipes`
| Field | Type | Description |
|-------|------|-------------|
| `swiper_profile_id` | string | Profile that initiated the swipe |
| `swiped_profile_id` | string | Profile being swiped on |
| `direction` | string | `left` or `right` |
| `created_at` | timestamp | Server-side timestamp |

### Collection: `matches`
| Field | Type | Description |
|-------|------|-------------|
| Document ID | string | Deterministic: `match_{sorted_profile_ids}` |
| `profiles` | array | Both profile IDs |
| `created_at` | timestamp | Server-side timestamp |

### Collection: `profiles_profiles_cache` (populated by `discovery_subscriber`)
| Field | Type | Description |
|-------|------|-------------|
| Document ID | string | Profile ID (mirrors profiles DB) |
| `profile_id` | string | Profile ID |
| `user_id` | string | Owner UID |
| `display_name` | string | Cached from profiles service |
| `tagline` | string | Cached tagline |
| `bio` | string | Cached bio |
| `image_urls` | array\<string\> | Cached image URLs |
| `gender` | array\<tag\> | Cached gender tags `{id, name, slug}` |
| `race` | array\<tag\> | Cached race tags |
| `fandom` | array\<tag\> | Cached fandom tags |
| `interests` | array\<tag\> | Cached interest tags |
| `events` | array\<tag\> | Cached event tags |
| `looking_for` | array\<tag\> | Cached looking-for tags |
| `age` | int | Cached age |
| `is_oc` | bool | Cached original character flag |

## Event Flow

```
Profiles Service → Pub/Sub (profile events) → Discovery Subscriber → Firestore (profiles_profiles_cache)
                                                                          ↑
Discovery API (feed/swipe) reads from ────────────────────────────────────┘

Discovery API → Pub/Sub (match events) → Messages Subscriber → Firestore (discovery_matches_cache)
```

### Feed Generation Logic
1. Load the requesting profile from `profiles_profiles_cache`
2. Get all swipes by this profile from `swipes` collection
3. Query `profiles_profiles_cache` via Firestore Pipeline, excluding:
   - The requesting profile itself
   - All already-swiped profiles
4. Return results sorted deterministically by document ID

### Match Detection Logic
1. On `right` swipe: check for reciprocal right swipe from the target
2. If reciprocal found: create match with deterministic ID `match_{sorted_ids}`
3. Publish `match_created` event to Pub/Sub

## Running

### With Docker Compose
```bash
docker compose up discovery discovery-subscriber
```

### With Air (hot-reload)
```bash
cd services/discovery/discovery_go && air
cd services/discovery/discovery_subscriber && air
```

## Testing
```bash
# discovery_go
cd services/discovery/discovery_go && go test -v ./...

# discovery_subscriber
cd services/discovery/discovery_subscriber && go test -v ./...
```

## Tech Stack
- **Language**: Go (Gin + CORS)
- **Auth**: JWT middleware (Tavern JWT, local verification)
- **Database**: Firestore `discovery-{env}` (`swipes`, `matches`, `profiles_profiles_cache`)
- **Events**: Pub/Sub + Protobuf (consumes profile events, publishes match events)
- **Docs**: Swagger UI at `/discovery/swagger/`
- **Deployment**: Cloud Run via Cloud Build
