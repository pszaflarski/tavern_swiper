# AGENTS.md — AI Assistant Context

> **Read this first.** This is the structured entry point for any AI coding assistant working on this project.

## Project Identity

| Key | Value |
|-----|-------|
| Name | Tavern Swiper |
| Type | Microservice backend (Go/Gin) + React Native frontend (Expo) |
| Theme | Fantasy dating app — maintain thematic nomenclature |
| Environments | `dev`, `test`, `prod` |
| GCP Projects | `tavern-swiper-dev` (dev/test), `tavern-swiper-prod` (prod) |
| Deploy Branches | `dev`, `test`, `prod` — each auto-deploys via Cloud Build |
| `main` branch | **NOT a deploy branch** — do not push expecting deployment |

## Service Registry

| Service | Boundary | Port | Database | Path |
|---------|----------|------|----------|------|
| `auth_go` | auth | 8001 | `users-{env}` | `services/auth/auth_go/` |
| `users_go` | auth | 8006 | `users-{env}` | `services/auth/users_go/` |
| `profiles_go` | profiles | 8002 | `profiles-{env}` | `services/profiles/profiles_go/` |
| `discovery_go` | discovery | 8003 | `discovery-{env}` | `services/discovery/discovery_go/` |
| `discovery_subscriber` | discovery | 8007 | `discovery-{env}` | `services/discovery/discovery_subscriber/` |
| `messages_go` | messages | 8005 | `messages-{env}` | `services/messages/messages_go/` |
| `messages_subscriber` | messages | 8008 | `messages-{env}` | `services/messages/messages_subscriber/` |
| `router_go` | router | 8010 | `router-{env}` | `services/router/router_go/` |

## Absolute Rules

1. **SHARED NOTHING**: No cross-service code sharing. Code duplication is preferred over coupling. Each container has its own `go.mod`, `Dockerfile`, `cloudbuild.yaml`, `.env`.
2. **DATABASE ISOLATION**: Each boundary has its own Firestore database instance. Never query another boundary's database.
3. **NO SERVICE ACCOUNT KEYS**: ADC + IAM impersonation only. Never create or reference `service-account.json`.
4. **NO SYSTEM PYTHON**: Always use `.venv/bin/python3`.
5. **NO AUTO-DOCKER**: Never run `docker compose up/build` or `tests/run_integration_tests.sh --local` without explicit user permission. Risk of OOM.
6. **FEATURE BRANCHES ONLY**: Never commit directly to `dev`, `test`, or `prod` without user approval.
7. **ZERO-TRUST AUTH**: Every endpoint (except `/auth/login`, `/auth/register`, and health/swagger) must verify the Tavern JWT. Each service has its own `auth.go` middleware.
8. **BROWSER ISOLATION**: Always use an isolated Chromium binary and dedicated profile path for `browser_subagent` tasks to prevent profile leakage and session conflicts.

## JWT Architecture

All backend services share the same `JWT_SECRET` for local HMAC-based token verification. This eliminates per-request calls to the Auth service. The flow:

1. Frontend authenticates with Firebase → gets Firebase ID token
2. Frontend calls `POST /auth/verify` with Firebase token → gets Tavern JWT
3. All subsequent API calls use the Tavern JWT as `Authorization: Bearer <token>`
4. Each service verifies the JWT locally using the shared secret

## Pub/Sub Event System

| Publisher | Topic | Subscriber | Cache Collection |
|-----------|-------|------------|-----------------|
| `profiles_go` | `{env}-profiles-profile-events-v1` | `discovery_subscriber` | `profiles_profiles_cache` in discovery DB |
| `discovery_go` | `{env}-discovery-match-events-v1` | `messages_subscriber` | `discovery_matches_cache` in messages DB |

Events use **Protobuf** serialization. Subscribers are push-based (Cloud Run endpoints or local pull in Docker).

## File Conventions (per Go service)

Every service container MUST include:

```
main.go              # Entry point, CORS, Swagger UI, auth middleware, routes
handlers.go          # HTTP handlers with Swagger godoc annotations
models.go            # Request/response structs with json/firestore tags
auth.go              # JWT auth middleware (duplicated per service)
errors.go            # Standardized error helpers (send400, send403, send404, send500)
firestore.go         # Firestore client init with getDBFunc pattern
firestoreutil.go     # Firestore interface abstractions for testability
mock_firestore.go    # Mock implementations for unit tests
handlers_test.go     # Unit tests using httptest and gin.TestMode
docs/                # Generated Swagger docs (swag init)
Dockerfile           # Multi-stage Alpine build
cloudbuild.yaml      # Cloud Build pipeline (test → build → push → deploy)
.env                 # Local env vars (gitignored)
.env.example         # Template for .env (committed)
```

## Frontend Rules

- **Directory**: All `npm`, `npx`, `jest` commands run from `frontend/`
- **No Direct Firestore**: Frontend calls microservice APIs only. Firebase SDK is auth-only.
- **Env Vars**: Must be accessed as static literals: `process.env.EXPO_PUBLIC_X` (dynamic access silently fails in Expo web builds)
- **Design System**: Use Stitch tokens from `frontend/theme/tokens.ts`
- **State**: React Query for server state, Context API for UI state

## Quick Reference

| Task | Command |
|------|---------|
| Run backend tests | `cd services/<boundary>/<container> && go test -v ./...` |
| Run frontend tests | `cd frontend && npm test` |
| Run integration tests | `bash tests/run_integration_tests.sh --local` |
| Switch frontend env | `bash scripts/switch_env.sh [local\|dev\|test]` |
| Clear environment | `.venv/bin/python3 scripts/clear_system.py [dev\|test]` |
| Seed sample data | `.venv/bin/python3 scripts/seed_profiles.py [dev\|test]` |
| Regenerate Swagger | `cd services/<boundary>/<container> && swag init` |
