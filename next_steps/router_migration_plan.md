# Frontend Router Migration & Service Tagging Plan

This document outlines the strategy for consolidating multiple microservice endpoints into a single API Router/Gateway and implementing a robust versioning/tagging strategy in Cloud Run.

## 1. Objectives
- **Consolidation**: Reduce the number of environment variables in the frontend from 5+ URLs to a single `BASE_API_URL`.
- **Abstraction**: Allow backend service URLs to change or scale without requiring frontend re-builds.
- **Versioning**: Implement Cloud Run tags (`latest`, `stable`, `v1`, `v2`) to manage traffic and rollouts safely.
---

## 2. Phase 1: Implement the Router Service
Create a new microservice (e.g., `services/router`) that acts as a reverse proxy.

### Architecture
- **Technology**: Go with Gin or specialized proxy middleware (e.g., `httputil.ReverseProxy`).
- **Routing Logic**:
  - `/auth/*` -> `AUTH_SERVICE_URL`
  - `/profiles/*` -> `PROFILES_SERVICE_URL`
  - `/discovery/*` -> `DISCOVERY_SERVICE_URL`
  - `/messages/*` -> `MESSAGES_SERVICE_URL`
  - `/users/*` -> `USERS_SERVICE_URL`

### Benefits
- Single entry point for CORS configuration.
- Simplified authentication validation at the edge.
- Centralized logging and request tracing.

---

## 3. Phase 2: Frontend Migration
Update the mobile and web frontend to point all requests to the new Router.

### Steps
1. **Update `.env`**:
   ```env
   # Old
   # EXPO_PUBLIC_AUTH_URL=...
   # EXPO_PUBLIC_PROFILES_URL=...

   # New
   EXPO_PUBLIC_API_ROUTER_URL=https://router-dev-hhqol7siba-uc.a.run.app
   ```
2. **Refactor `lib/api.ts`**:
   Modify the base client to use path prefixes instead of distinct base URLs.
   ```typescript
   // Example Change
   const getProfile = (id) => axios.get(`${API_URL}/profiles/${id}`);
   ```

---

## 4. Phase 3: Cloud Run Tagging Strategy
Leverage Cloud Run's traffic management to provide predictable entry points.

### Tag Definitions
- **`latest`**: 
  - Automatically assigned to the most recent successful deployment.
  - Used by developers for integration testing.
- **`stable`**: 
  - Points to the revision currently serving production traffic.
  - Promoted manually or via CI/CD after passing integration tests.
- **`v1`, `v2`**: 
  - Immutable tags for specific API versions.
  - Allows the frontend to request a specific version of a service (e.g., `v1.router.a.run.app`).

### Implementation (gcloud)
```bash
# Deploy with a specific tag
gcloud run deploy router --image gcr.io/project/router --tag v1

# Map a tag to a URL (e.g., stable.router.a.run.app)
gcloud beta run services update-traffic router --to-tags stable=100

# Gradual Rollout (Blue/Green)
gcloud run services update-traffic router --to-revisions LATEST=10,STABLE=90
```

---

## 5. Verification Plan
1. **Local Proxy Test**: Run the router locally via Docker and point the frontend to `localhost:8080`.
2. **Staging Rollout**: Deploy the router to the `test` environment with the `latest` tag.
3. **Production cutover**: Promote the `latest` revision to the `stable` tag and update DNS/Frontend config.

## 6. Rollback Strategy
- If the Router fails, revert the frontend's `.env` to the original multi-service URLs.
- Use `gcloud run services update-traffic --to-revisions PREVIOUS_REVISION=100` for instant backend rollbacks.
