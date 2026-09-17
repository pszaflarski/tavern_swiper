# Auth Service Boundary

The Auth boundary is the identity and authorization layer for all of Tavern Swiper. It enforces identity authentication, user role-based access control (RBAC), and manages account state transitions.

---

## 1. Architectural Taxonomy & Principles

### Principle 1: Interaction Exclusively Through Explicit Contracts
All external interactions occur strictly across versioned OpenAPI REST contracts (for operational endpoints) or shared token specifications (HMAC-SHA256 Tavern JWT). Direct access to internal structures or underlying persistence is forbidden.

### Principle 2: Defined Business Purpose (Bounded Context)
- **Bounded Context**: Identity management, credential authentication, JWT token minting, user profile pointer linking, and account RBAC authorization (`user`, `admin`, `root_admin`).
- **Domain Invariants**: Every user record corresponds to a valid Firebase Auth UID; role changes and premium status toggles are restricted to administrative operations.

### Principle 3: Complete Autonomy of Operational Data
- **Autonomous Persistence Engine**: Dedicated Firestore database `users-{env}` (Collection: `users`).
- **Isolation Constraint**: No external microservice may query or modify `users-{env}` directly. All account state reads/writes are mediated via `users_go` or `auth_go`.

---

## 2. The Three Interfaces (3D Architecture)

| Interface Dimension | Target Access Pattern | Typical Protocols / Formats | Primary Purpose & Container Implementation |
|---|---|---|---|
| **1. Synchronous Operational (OLTP)** | Low-latency authentication, token exchange, account CRUD | REST (OpenAPI / Swagger via Gin) | `auth_go` (:8001) & `users_go` (:8006) handle identity verification, JWT minting (`/auth/verify`), and user profile updates (`/users/me`). |
| **2. Analytical Query (OLAP)** | High-throughput registration scans, user retention, RBAC reporting | BigQuery exports / Materialized SQL Views | `users_analytics` provides read-optimized domain projections to query engines without impacting transactional Firestore workloads. |
| **3. Asynchronous Streaming (Events)** | Identity lifecycle triggers, deletion cascade notifications | GCP Pub/Sub & Webhook events | Publishes user account state transitions (e.g. deletion events) for cross-service cleanup and audit logs. |

---

## 3. Position in the System & Topology

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
                                           │   users, router, etc.)                  │
                                           └─────────────────────────────────────────┘
```

**Every service in the system depends on `auth_go`** for initial token issuance. After that, all services verify the Tavern JWT locally using the shared `JWT_SECRET` — no per-request calls back to auth.

---

## 4. Physical Containers

### `auth_go` — Authentication API (OLTP)
Handles Firebase Auth identity operations: user registration, login, token verification, and JWT minting.
- **Port**: `8001`
- **Base path**: `/auth`
- **Database**: `users-{env}`
- **Key endpoints**:
  - `POST /auth/register` — Create a new Firebase Auth user via Identity Toolkit
  - `POST /auth/login` — Authenticate with email/password, returns a Firebase ID token
  - `POST /auth/verify` — Verify a Firebase ID token and mint a Tavern JWT (includes user role from Firestore)
  - `POST /auth/dev-mint` — Mint long-lived dev/test JWTs (dev projects only)
  - `DELETE /auth/users/:uid` — Delete a single Firebase Auth user
  - `DELETE /auth/users/` — Bulk delete Firebase Auth users by UID list
  - `DELETE /auth/all` — Delete all Firebase Auth users (root_admin only)

### `users_go` — User Records API (OLTP)
Manages user account records in Firestore with RBAC (`user`, `admin`, `root_admin`).
- **Port**: `8006`
- **Base path**: `/users`
- **Database**: `users-{env}`
- **Key endpoints**:
  - `GET /users/me` — Get or auto-initialize the authenticated user's record
  - `PUT /users/me` — Update fields (**cannot** change `user_type` or `is_premium`)
  - `POST /users/` — Create a user record (self-registration or admin creation)
  - `GET /users/` — List all users (Admin+)
  - `PUT /users/{uid}` — Admin-only updates (role, premium status)
  - `DELETE /users/{uid}` — Soft or hard-delete a user (Admin+)
  - `PATCH /users/{uid}/restore` — Restore a soft-deleted user (Admin+)
  - `DELETE /users/` — Purge all users and cascade to Firebase Auth via auth_go (Root Admin only)
  - `GET /users/root-admin-exists` — Check if root admin is registered (public)

### `users_analytics` — Analytical Engine (OLAP)
Exposes read-optimized user metrics and analytical pipelines.
- **Path**: `services/auth/users_analytics`
- **Database Target**: BigQuery / SQL Analytical Views
- **Purpose**: Aggregates user registration rates, retention statistics, and role distribution without transactional overhead.

---

## 5. Cross-Service Dependencies

### Provided to external services:
| Consumer | What It Uses | Mechanism |
|---|---|---|
| **All services** | JWT verification | Local verification of Tavern JWT using `JWT_SECRET` |
| **Frontend** | Token exchange | `POST /auth/verify` converts Firebase ID tokens to Tavern JWTs |
| **users_go** | Firebase Auth deletion | `DELETE /auth/users/` called during user purge |

### Dependencies:
| Dependency | Purpose | Protocol |
|---|---|---|
| **Firebase Auth** | Identity verification | REST API to Identity Toolkit |

---

## 6. Data Model

**Database**: `users-{env}`

### Collection: `users`
| Field | Type | Description |
|---|---|---|
| `uid` | string | Firebase Auth UID (document ID) |
| `email` | string | User email |
| `display_name` | string | Display name |
| `user_type` | string | `user`, `admin`, or `root_admin` |
| `is_premium` | bool | Premium status |
| `active_profile_id` | string | Currently active profile ID |
| `is_deleted` | bool | Soft-delete flag |
| `created_at` | timestamp | Server-side creation timestamp |
| `updated_at` | timestamp | Server-side last modification |

---

## 7. Running & Testing

### Docker Compose
```bash
docker compose up auth users
```

### Air Hot-Reload
```bash
cd services/auth/auth_go && air
cd services/auth/users_go && air
```

### Unit Tests
```bash
cd services/auth/auth_go && go test -v ./...
cd services/auth/users_go && go test -v ./...
cd services/auth/users_analytics && go test -v ./...
```
