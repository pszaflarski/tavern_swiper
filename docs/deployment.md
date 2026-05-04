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
bash tests/run_integration_tests.sh --local
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

### 2. Bootstrapping an Environment
To create all required Firestore Enterprise databases and apply their initial indexes:
```bash
bash scripts/setup-databases.sh [dev|test|prod]
```

> [!WARNING]
> **Database ID Cooldown:** If you delete a database and attempt to recreate it with the same ID immediately, Google Cloud enforces a **5-minute (300s) cooldown**. The setup script will fail during this period.

### 3. Updating Indexes
If you add a new `Where` or `OrderBy` query to a service, you must:
1. Update the corresponding `firestore.indexes.json`.
2. Run the apply script:
```bash
bash scripts/apply-indexes.sh [dev|test|prod]
```

> [!IMPORTANT]
> When adding a new `Where` or `OrderBy` query to a service, you **must** update the corresponding `firestore.indexes.json` and run the apply script. Otherwise, Firestore will perform expensive full collection scans.

---

## GCS Media Bucket Setup

Each environment needs a Cloud Storage bucket for profile images. The bucket uses **Uniform Bucket-Level Access** (the GCP default), so public read access must be granted via an IAM policy — per-object ACLs are disabled.

### 1. Create the Bucket
```bash
gcloud storage buckets create gs://$PROJECT_ID-media-$ENV \
  --location=us-central1 \
  --uniform-bucket-level-access
```

### 2. Grant Public Read Access
> [!CAUTION]
> This makes all objects in the bucket publicly readable. Only apply this to media buckets that serve profile images.

```bash
gcloud storage buckets add-iam-policy-binding gs://$PROJECT_ID-media-$ENV \
  --member=allUsers \
  --role=roles/storage.objectViewer
```

### 3. Verify
```bash
gcloud storage buckets get-iam-policy gs://$PROJECT_ID-media-$ENV
```
Confirm `allUsers` has `roles/storage.objectViewer`.

> [!WARNING]
> Without the public IAM policy, uploaded images will return `403 Forbidden` when the frontend tries to display them. The backend upload will appear to succeed, but images will be blank.

---

## Pub/Sub Push Subscriptions

The profiles service publishes events to Pub/Sub when profiles are created, updated, or deleted. Subscribers (Cloud Run services) receive these events via **push subscriptions**. Topics are created automatically by the backend services, but **subscriptions must be provisioned manually** for each environment.

### Required Subscriptions

| Subscription | Topic | Push Endpoint |
|---|---|---|
| `$ENV-discovery-subscriber-push-sub` | `$ENV-profiles-profile-events-v1` | `discovery-subscriber-$ENV` Cloud Run URL |
| `$ENV-messages-subscriber-push-sub` | `$ENV-discovery-match-events-v1` | `messages-subscriber-$ENV` Cloud Run URL |

### Setup Commands
```bash
# Discovery subscriber (receives profile events)
gcloud pubsub subscriptions create $ENV-discovery-subscriber-push-sub \
  --topic=$ENV-profiles-profile-events-v1 \
  --push-endpoint=$(gcloud run services describe discovery-subscriber-$ENV --region=us-central1 --format='value(status.url)') \
  --push-auth-service-account=tavern-swiper-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --ack-deadline=10 \
  --project=$PROJECT_ID

# Messages subscriber (receives match events)
gcloud pubsub subscriptions create $ENV-messages-subscriber-push-sub \
  --topic=$ENV-discovery-match-events-v1 \
  --push-endpoint=$(gcloud run services describe messages-subscriber-$ENV --region=us-central1 --format='value(status.url)') \
  --push-auth-service-account=tavern-swiper-sa@$PROJECT_ID.iam.gserviceaccount.com \
  --ack-deadline=10 \
  --project=$PROJECT_ID
```

> [!WARNING]
> Without push subscriptions, published events go nowhere. The discovery feed will be empty and matches won't propagate to the messages service.
