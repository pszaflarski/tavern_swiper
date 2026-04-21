# Deployment Guide

All deployments are automated via **Google Cloud Build** pipelines linked to GitHub.

## CI/CD Overview

### Backend Services
Each backend service uses its own Cloud Build config (e.g., `services/auth_go/cloudbuild.yaml`):
1. Runs unit tests (`go test ./...`) inside a Go 1.25 container.
2. Builds and pushes a Docker image to GCR.
3. Deploys to Cloud Run with the appropriate environment suffix (`-dev` or `-test`).

### Frontend
The frontend uses its own Cloud Build config at `frontend/cloudbuild.yaml`:
1. Runs Jest unit tests.
2. Fetches backend Cloud Run URLs for the target environment.
3. Builds an Expo web bundle inside a Docker image with injected env vars.
4. Deploys the containerized frontend to Cloud Run.

### Triggering Deployments
Push to `main` to trigger Cloud Build pipelines for both backend services and the frontend.

---

## Pre-Push Checklist

### 1. Test Backend Services
Run unit tests for any changed services:
```bash
cd services/<service-name>_go
go test -v ./...
```

### 2. Test Backend Integration
Run integration tests to verify cross-service communication:
```bash
bash tests/run_go_integration_tests.sh --local
```

### 3. Test Frontend (Jest)
Run frontend unit and hook tests to validate UI logic:
```bash
cd frontend && npm test
```

### 4. Push to GitHub

> [!WARNING]
> **Never push directly to `main` or `test`.** These branches have automated Cloud Build triggers. Always use feature branches and open a Pull Request.

```bash
git checkout -b <type>/<description>
git push origin <branch-name>
# Open a PR for merge into main or test
```

Cloud Build will automatically:
1. Run unit tests for each changed service.
2. Build and push Docker images to GCR.
3. Deploy to Cloud Run with the appropriate environment suffix.

---

## Environment Switching (Frontend)

Easily toggle the frontend between local, dev (cloud), and test (cloud) environments:
```bash
bash scripts/switch_env.sh [local|dev|test]
```
