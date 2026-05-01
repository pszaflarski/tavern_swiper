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

---

## Environment Management (GCP)

We use `gcloud` configurations to quickly switch between the development and production projects.

### 1. List Available Configurations
```bash
gcloud config configurations list
```

### 2. Switch to Development (Default)
```bash
gcloud config configurations activate default
```

### 3. Switch to Production
```bash
gcloud config configurations activate prod
```

### 4. Create a New Configuration (If needed)
If you need to set up a new environment locally:
```bash
gcloud config configurations create <name>
gcloud config set project <project-id>
gcloud config set account <your-email>
```

---

## Database Setup & Indexing (Enterprise Edition)

Since we use Firestore Enterprise, **automatic single-field indexing is disabled**. Every queried field must have an explicit index defined.

### 1. Index Source of Truth
Each service maintains its own `firestore.indexes.json` file:
- `services/profiles_go/firestore.indexes.json`
- `services/discovery_go/firestore.indexes.json`
- `services/messages_go/firestore.indexes.json`
- `services/users_go/firestore.indexes.json`

### 2. Applying Indexes
To apply indexes to a new or existing environment (e.g., `dev` or `test`):
```bash
bash scripts/apply-indexes.sh [dev|test]
```
This script iterates through all services and creates both single-field and composite indexes using `gcloud`.

> [!IMPORTANT]
> When adding a new `Where` or `OrderBy` query to a service, you **must** update the corresponding `firestore.indexes.json` and run the apply script. Otherwise, Firestore will perform expensive full collection scans.

