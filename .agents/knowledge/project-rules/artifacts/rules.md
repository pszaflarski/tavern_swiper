# Tavern Swiper — Mandatory Rules

> **READ THIS BEFORE EVERY PLAN OR IMPLEMENTATION.**
> Source: `.cursorrules` + operational lessons.

---

## 🚨 ABSOLUTE RULES (Never Violate)

### 1. SHARED NOTHING — Complete Service Isolation
- Containers are grouped by domain boundary under `services/<boundary>/<container>/`.
- Each container is a **fully independent unit** — it must be able to function as its own repository.
- **NEVER** create shared libraries, shared modules, or cross-directory dependencies between containers.
- **NEVER** use Go `replace` directives pointing to sibling directories.
- **Code duplication between containers is PREFERRED** over coupling.
- Containers within a boundary share the same DB but **never share code**.
- Each container has its own: `go.mod`, `Dockerfile`, `cloudbuild.yaml`, `.env`.
- Boundaries: `auth/` (auth_go, users_go), `profiles/` (profiles_go), `discovery/` (discovery_go, discovery_subscriber), `messages/` (messages_go, messages_subscriber)

### 2. STRICT DATABASE ISOLATION
- Each boundary uses its own dedicated Firestore database instance:
  - `auth` boundary (auth_go + users_go) → `users-<env>` (no separate auth DB)
  - `profiles` boundary → `profiles-<env>`
  - `discovery` boundary → `discovery-<env>`
  - `messages` boundary → `messages-<env>`

### 3. NO SYSTEM PYTHON
- **NEVER** run Python with the system interpreter. Always use `.venv/bin/python3`.

### 4. NO STATIC SERVICE ACCOUNT KEYS
- **NEVER** use `service-account.json` files. Use ADC + impersonation only.

### 5. NO DIRECT DOCKER STARTUP
- **NEVER** auto-run `docker compose up`, `docker compose build`, or `tests/run_integration_tests.sh --local`. These risk OOM. Always ask the user first.

### 6. BRANCH PROTECTION & DEPLOY BRANCHES
- The **three deploy branches** are: `dev`, `test`, `prod`. Each has Cloud Build triggers that auto-deploy on push.
  - `dev` → deploys to `tavern-swiper-dev`
  - `test` → deploys to `tavern-swiper-dev` (test triggers)
  - `prod` → deploys to `tavern-swiper-prod`
- **`main` is NOT a deploy branch.** Do not push to `main` expecting a deployment.
- Always create a feature branch first: `git checkout -b <type>/<description>`.
- Merge to `dev` first, verify, then promote to `test` and `prod`.

---

## ⚠️ IMPORTANT PATTERNS

### Security: Zero-Trust
- All endpoints (except `auth/login` and `auth/register`) MUST verify Firebase ID tokens via the `auth` service.
- Each Go service has its own `auth.go` middleware — no shared auth library.

### Frontend: Expo/React Native
- All `npm`/`npx` commands MUST run from `frontend/` directory.
- Frontend NEVER calls Firestore directly — only through microservice APIs.
- Env vars must be accessed statically: `process.env.EXPO_PUBLIC_X` (not dynamically).

### Deployment
- Deploy by pushing to `dev`, `test`, or `prod` branches — these trigger Cloud Build.
- **`main` does NOT trigger deployments.** The prod deploy branch is `prod`.
- `gcloud run deploy` is only for temporary testing/debugging.
- `_DIR_NAME` in triggers must be basename only (e.g. `auth_go`, not `services/auth_go`).

### Port Assignments
| Service | Port |
|---|---|
| Auth | 8001 |
| Profiles | 8002 |
| Discovery | 8003 |
| Messages | 8005 |
| Users | 8006 |

### Testing
- Run `go test -v ./...` from each service directory after backend changes.
- Never reuse JWT secrets across environments.

---

## 📋 Pre-Implementation Checklist

Before creating any plan or making changes, verify:

- [ ] Does this change introduce cross-service dependencies? → **REJECT**
- [ ] Does this change share code between services? → **REJECT — duplicate instead**
- [ ] Does this change push directly to `dev`, `test`, or `prod` without approval? → **REJECT — use feature branch, merge after approval**
- [ ] Does this change use system Python? → **REJECT — use .venv**
- [ ] Does this change start Docker automatically? → **REJECT — ask user**
