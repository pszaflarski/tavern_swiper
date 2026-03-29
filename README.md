# The Tavern Swipes — Trystr

> *"Every interaction should feel like a discovery."*

A fantasy-themed dating app with a **strictly isolated, zero-trust microservice backend** and a React Native (Expo) frontend.

---

## Architecture

This project follows a "Shared Nothing" microservice architecture. Each service is a completely self-contained unit with its own logic, dependencies, and **dedicated Firestore database instance**.

### Key Infrastructure
- **Microservices**: 6 core services (Auth, Profiles, Discovery, Swipes, Messages, Users).
- **Dual Environments**: Every service supports **Dev** and **Test** deployments on Google Cloud Run.
- **Database Isolation**: Targeted at **12 distinct Firestore databases** (6 for `dev`, 6 for `test`).
- **Truly Keyless**: Local development and Cloud Run deployments use **IAM Impersonation** instead of static service account keys.

---

## Local Setup & Identity

### 1. Prerequisites
- Docker & Docker Compose v2
- Google Cloud SDK (`gcloud`)
- A Google Cloud Project (`tavern-swiper-dev`)
- A Firebase Web API Key

### 2. Truly Keyless Configuration
We no longer use `service-account.json` files. Instead, your local identity impersonates a specific service account.

**One-time Setup**:
```bash
# Unset any current impersonation to grant permissions
gcloud config unset auth/impersonate_service_account

# Grant yourself the ability to act as the service account
gcloud iam service-accounts add-iam-policy-binding \
  tavern-swiper-sa@tavern-swiper-dev.iam.gserviceaccount.com \
  --member="user:your-email@gmail.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=tavern-swiper-dev

# Re-enable impersonation
gcloud config set auth/impersonate_service_account \
  tavern-swiper-sa@tavern-swiper-dev.iam.gserviceaccount.com
```

### 3. Start the Backend (Docker)
From the root directory:
```bash
docker compose up --build
```
*Note: Containers now dynamically listen on the port provided by the `$PORT` environment variable.*

---

## Admin Nexus Dashboard

The project includes a centralized administrative dashboard for user management and system resets.

**Start the Admin Interface**:
```bash
bash serve_admin.sh
```
Access the dashboard at `http://localhost:8000/admin.html`. It provides tools to:
- Reset the entire system ("The Nuke" button).
- Manage per-service records and Firestore documents.

---

## Testing

### Integration Testing (Local)
Runs tests against your local Docker Compose environment:
```bash
bash run_integration_tests.sh
```

### Integration Testing (Cloud)
Runs tests against actual **Google Cloud Run** endpoints in the `test` environment:
```bash
bash scripts/run_cloud_integration_tests.sh
```

---

## Cloud Deployment

Deploy the entire microservice fleet (both `dev` and `test` environments) to Cloud Run:
```bash
bash scripts/deploy_to_cloud_run.sh
```

---

## Frontend (React Native)

The frontend uses **Expo** and the **Stitch Design System**.

```bash
cd frontend
npm install
npx expo start
```

### Environment Switching
Easily toggle the frontend between local, dev (cloud), and test (cloud) environments:
```bash
bash scripts/switch_env.sh [local|dev|test]
```
