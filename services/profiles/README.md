# Profiles Service

The Profiles service manages user profile CRUD, image uploads, and active-profile selection for Tavern Swiper. It is the source of truth for profile data and publishes profile events to downstream services.

## Containers

### `profiles_go` — Profiles API
Full profile lifecycle management including creation, updates, image uploads with server-side normalization, and active profile toggling.

- **Port**: `8002` (configurable via `PORT`)
- **Base path**: `/profiles`
- **Key endpoints**:
  - `POST /profiles/` — Create a new profile (auto-sets as active, deactivates others for the same user)
  - `GET /profiles/:id` — Get a single profile by ID
  - `PUT /profiles/:id` — Update profile fields (owner or admin)
  - `DELETE /profiles/:id` — Delete a profile (owner or admin)
  - `POST /profiles/:id/set_active` — Set a profile as the user's active profile (deactivates all others)
  - `POST /profiles/:id/image` — Upload and attach a profile image (JPEG normalization, GCS storage)
  - `GET /profiles/user/me` — List all profiles for the authenticated user
  - `GET /profiles/user/me/active` — Get the user's active profile (auto-activates one if none active)
  - `GET /profiles/user/:user_id` — List all profiles for a specific user (self or admin)
  - `POST /profiles/batch` — Batch-fetch profiles by ID list
  - `GET /profiles/all` — List all profiles (Admin+ only)
  - `DELETE /profiles/` — Purge all profiles (Root Admin only)

### `tags` — Filtering Attributes
The tags system allows for granular categorization of profiles.

- **Base path**: `/profiles/tags`
- **Endpoints**:
  - `GET /:id` — Get tag by ID
  - `GET /slug/:slug` — Get tag by unique slug
  - `GET /category/:category` — List all tags in a category
  - `POST /search` — Case-insensitive prefix search (for autocomplete)
  - `POST /validate` — Cross-service existence check for tag combinations
  - `POST /` — Create a new tag (Admin+ only)
  - `PUT /:id` — Update a tag (Admin+ only)
  - `DELETE /:id` — Delete a tag (Admin+ only)
  - `POST /suggest` — Submit a user suggestion for a new tag
  - `GET /suggestions` — List all suggestions (Admin+ only)
  - `DELETE /suggestions/:id` — Reject/Delete a suggestion (Admin+ only)

## Event Publishing
The Profiles service publishes Protobuf-serialized events to Pub/Sub on every profile mutation:
- **`UPSERTED`** — Profile created, updated, activated, deactivated, or image added
- **`DELETED`** — Profile deleted
- **`ALL_DELETED`** — Admin purge

These events are consumed by the Discovery Subscriber to keep its local profile cache in sync.

```
Profiles API → Pub/Sub (profile events) → Discovery Subscriber
```

## Running

### With Air (hot-reload)

```bash
cd services/profiles/profiles_go
air
```

### With Docker Compose

```bash
# From the repo root — starts profiles and all dependencies
docker compose up profiles
```

### Standalone Docker

```bash
docker build -t profiles-go ./services/profiles/profiles_go
docker run -p 8002:8002 profiles-go
```

## Testing

```bash
# Unit tests (mocks)
cd services/profiles/profiles_go
go test ./...

# Integration tests against real Firestore
go test ./... -run Integration -real-db
```

## Tech Stack
- **Language**: Go
- **Framework**: Gin + CORS
- **Auth**: JWT middleware (Tavern JWT)
- **Database**: Firestore (`profiles` collection)
- **Storage**: Google Cloud Storage (profile images with server-side JPEG normalization)
- **Messaging**: Google Cloud Pub/Sub (publish profile events)
- **Serialization**: Protocol Buffers
- **Docs**: Swagger UI via swag (`/profiles/swagger/`)
- **Deployment**: Cloud Run via Cloud Build
