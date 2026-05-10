# Auth Service

The Auth service is the authentication and user management domain for Tavern Swiper. It contains two independently deployed containers that share the `services/auth/` boundary.

## Containers

### `auth_go` — Authentication API
Handles Firebase Auth identity operations: user registration, login, token verification, and JWT minting.

- **Port**: `8001`
- **Base path**: `/auth`
- **Key endpoints**:
  - `POST /auth/register` — Create a new Firebase Auth user via the Identity Toolkit REST API
  - `POST /auth/login` — Authenticate with email/password, returns a Firebase ID token
  - `POST /auth/verify` — Verify a Firebase ID token and mint a Tavern JWT (includes user role from Firestore)
  - `POST /auth/dev-mint` — Mint long-lived dev/test JWTs (emulator and `-dev` projects only)
  - `DELETE /auth/users/:uid` — Delete a single Firebase Auth user
  - `DELETE /auth/users/` — Bulk delete Firebase Auth users by UID list
  - `DELETE /auth/all` — Delete all Firebase Auth users (admin/test use)

### `users_go` — User Records API
Manages user account records in Firestore with RBAC (user, admin, root_admin).

- **Port**: `8006`
- **Base path**: `/users`
- **Key endpoints**:
  - `GET /users/me` — Get or auto-initialize the authenticated user's record
  - `PUT /users/me` — Update the authenticated user's fields (premium status, name, role)
  - `POST /users/` — Create a user record (self-registration, admin creation, root admin singleton)
  - `GET /users/` — List all users (Admin+)
  - `DELETE /users/:uid` — Soft or hard-delete a user (Admin+)
  - `PATCH /users/:uid/restore` — Restore a soft-deleted user (Admin+)
  - `DELETE /users/` — Purge all users and their Firebase Auth identities (Root Admin only)
  - `GET /users/root-admin-exists` — Check if a root admin has been registered

## Running

### With Air (hot-reload)

```bash
# auth_go
cd services/auth/auth_go
air

# users_go
cd services/auth/users_go
air
```

### With Docker Compose

```bash
# From the repo root — starts auth, users, and all dependencies
docker compose up auth users
```

### Standalone Docker

```bash
# auth_go
docker build -t auth-go ./services/auth/auth_go
docker run -p 8001:8001 auth-go

# users_go
docker build -t users-go ./services/auth/users_go
docker run -p 8006:8006 users-go
```

## Testing

```bash
# auth_go — unit tests (mocks)
cd services/auth/auth_go
go test ./...

# auth_go — integration tests against real Firestore
go test ./... -run Integration -real-db

# users_go — unit tests (mocks)
cd services/auth/users_go
go test ./...

# users_go — integration tests against real Firestore
go test ./... -run Integration -real-db
```

## Tech Stack
- **Language**: Go
- **Framework**: Gin + CORS
- **Auth**: Firebase Admin SDK, Firebase Auth REST API, custom Tavern JWT
- **Database**: Firestore (`users` collection)
- **Docs**: Swagger UI via swag (`/auth/swagger/`, `/users/swagger/`)
- **Deployment**: Cloud Run via Cloud Build
