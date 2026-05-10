# Auth Service Boundary

The Auth boundary is the identity and authorization layer for all of Tavern Swiper. It contains two independently deployed containers that share the `users-{env}` Firestore database.

## Position in the System

```
┌─────────────┐     Firebase ID Token      ┌──────────┐
│   Frontend   │ ─────────────────────────→ │ auth_go  │ ──→ Firebase Auth REST API
│  (Expo App)  │ ←───────────────────────── │  :8001   │      (Identity Toolkit)
│              │     Tavern JWT             └──────────┘
│              │                                 │
│              │     Tavern JWT (Bearer)          │  Shared JWT_SECRET
│              │ ─────────────────────────→ ┌─────┴──────────────────────────────────┐
└─────────────┘                            │  ALL other services verify JWT locally  │
                                           │  (profiles, discovery, messages,        │
                                           │   users, router)                        │
                                           └─────────────────────────────────────────┘
```

**Every service in the system depends on auth_go** for initial token issuance. After that, all services verify the Tavern JWT locally using the shared `JWT_SECRET` — no per-request calls back to auth.

## Containers

### `auth_go` — Authentication API

Handles Firebase Auth identity operations: user registration, login, token verification, and JWT minting.

- **Port**: `8001`
- **Base path**: `/auth`
- **Database**: `users-{env}` (shared with `users_go`)
- **Key endpoints**:
  - `POST /auth/register` — Create a new Firebase Auth user via the Identity Toolkit REST API
  - `POST /auth/login` — Authenticate with email/password, returns a Firebase ID token
  - `POST /auth/verify` — Verify a Firebase ID token and mint a Tavern JWT (includes user role from Firestore)
  - `POST /auth/dev-mint` — Mint long-lived dev/test JWTs (dev projects only)
  - `DELETE /auth/users/:uid` — Delete a single Firebase Auth user
  - `DELETE /auth/users/` — Bulk delete Firebase Auth users by UID list
  - `DELETE /auth/all` — Delete all Firebase Auth users (root_admin only)

### `users_go` — User Records API

Manages user account records in Firestore with RBAC (user, admin, root_admin).

- **Port**: `8006`
- **Base path**: `/users`
- **Database**: `users-{env}` (shared with `auth_go`)
- **Key endpoints**:
  - `GET /users/me` — Get or auto-initialize the authenticated user's record
  - `PUT /users/me` — Update the authenticated user's fields (**cannot** change `user_type` or `is_premium` — restricted fields)
  - `POST /users/` — Create a user record (self-registration, admin creation, root admin singleton)
  - `GET /users/` — List all users (Admin+)
  - `PUT /users/{uid}` — Admin-only updates (role, premium status)
  - `DELETE /users/{uid}` — Soft or hard-delete a user (Admin+)
  - `PATCH /users/{uid}/restore` — Restore a soft-deleted user (Admin+)
  - `DELETE /users/` — Purge all users and cascade to Firebase Auth via auth_go (Root Admin only)
  - `GET /users/root-admin-exists` — Check if a root admin has been registered (public)

## Cross-Service Dependencies

### This boundary provides to other services:
| Consumer | What It Uses | How |
|----------|-------------|-----|
| **All services** | JWT verification | Each service has its own `auth.go` that verifies the Tavern JWT using the shared `JWT_SECRET`. No runtime dependency on auth_go. |
| **Frontend** | Token exchange | `POST /auth/verify` converts Firebase ID tokens to Tavern JWTs |
| **users_go** | Firebase Auth deletion | `DELETE /auth/users/` is called by users_go during purge operations |

### This boundary depends on:
| Dependency | What For | How |
|-----------|---------|-----|
| **Firebase Auth** | Identity management | REST API calls to Identity Toolkit for register/login/delete |

### JWT Flow (critical context for all services)
1. Frontend authenticates with Firebase → gets Firebase ID token
2. Frontend calls `POST /auth/verify` with Firebase token → auth_go looks up user role from Firestore → mints Tavern JWT with `{sub: uid, role: user_type}`
3. All subsequent API calls use the Tavern JWT as `Authorization: Bearer <token>`
4. Each service verifies the JWT locally using the shared `JWT_SECRET` — no network call

## Data Model

**Database**: `users-{env}`

### Collection: `users`
| Field | Type | Description |
|-------|------|-------------|
| `uid` | string | Firebase Auth UID (document ID) |
| `email` | string | User email |
| `display_name` | string | Display name |
| `user_type` | string | `user`, `admin`, or `root_admin` |
| `is_premium` | bool | Premium status |
| `active_profile_id` | string | Currently active profile ID |
| `is_deleted` | bool | Soft-delete flag |
| `created_at` | timestamp | Server-side creation timestamp |
| `updated_at` | timestamp | Server-side last modification |

## Running

### With Docker Compose
```bash
# From the repo root
docker compose up auth users
```

### With Air (hot-reload)
```bash
cd services/auth/auth_go && air
cd services/auth/users_go && air
```

## Testing
```bash
# auth_go
cd services/auth/auth_go && go test -v ./...

# users_go
cd services/auth/users_go && go test -v ./...
```

## Tech Stack
- **Language**: Go (Gin + CORS)
- **Auth**: Firebase Auth REST API + custom Tavern JWT (HMAC-SHA256)
- **Database**: Firestore `users-{env}` (`users` collection)
- **Docs**: Swagger UI at `/auth/swagger/` and `/users/swagger/`
- **Deployment**: Cloud Run via Cloud Build
