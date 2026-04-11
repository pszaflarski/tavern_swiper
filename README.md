# The Tavern Swipes — Tavern Swiper

> *"Every interaction should feel like a discovery."*

A fantasy-themed dating app with a **strictly isolated, zero-trust microservice backend** and a React Native (Expo) frontend.

---

## Architecture

This project follows a "Shared Nothing" microservice architecture. Each service is a completely self-contained unit with its own logic, dependencies, and **dedicated Firestore database instance**.

### Key Infrastructure
- **Microservices**: 5 core services (Auth, Profiles, Discovery, Messages, Users).
- **Dual Environments**: Every service supports **Dev** and **Test** deployments on Google Cloud Run.
- **Database Isolation**: Targeted at **10 distinct Firestore databases** (5 for `dev`, 5 for `test`).
- **Truly Keyless**: Local development and Cloud Run deployments use **IAM Impersonation** instead of static service account keys.

---

## ⚙️ Firestore Indexing

This project uses advanced Firestore queries (e.g., matching + time-based sorting) that require **Composite Indexes**.

- **Automatic Workaround**: The services currently use in-memory sorting for testing and development to avoid immediate index requirements.
- **Production Requirement**: For large-scale data, you must provision composite indexes as documented in [docs/data_model.md](docs/data_model.md#️-firestore-index-requirements).

---

## Local Setup & Identity

### 1. Prerequisites
- Docker & Docker Compose v2
- Google Cloud SDK (`gcloud`)
- A Google Cloud Project (`tavern-swiper-dev`)
- A Firebase Web API Key
- Python 3.10+ (for scripts and testing)

### 2. Virtual Environment (Strict Isolation)
To ensure dependency consistency across microservices and administrative scripts, always use the project's root virtual environment:
```bash
# Create the environment (one-time)
python3 -m venv .venv

# Always activate before running any python scripts or pip commands
source .venv/bin/activate

# Install shared administrative dependencies
pip install google-cloud-firestore firebase-admin requests
```

### 3. Truly Keyless Configuration
We **NEVER** use `service-account.json` keys. Instead, your local identity impersonates a specific service account.

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

# Generate Application Default Credentials (ADC) for the impersonated identity
gcloud auth application-default login --impersonate-service-account=tavern-swiper-sa@tavern-swiper-dev.iam.gserviceaccount.com
```

**Inside Docker Compose**:
The `docker-compose.yml` is configured to mount your host's `~/.config/gcloud` directory. The containers use your impersonated ADC to authenticate with Google Cloud services (Firestore, GCS).

### 4. Start the Backend (Docker)
From the root directory:
```bash
docker compose up --build
```
*Note: Containers now dynamically listen on the port provided by the `$PORT` environment variable.*

---

## Admin Nexus Dashboard

The application includes an integrated administrative dashboard for user management, role assignment, and system-wide actions.

**Accessing the Admin Interface**:
1. Log in as a user with `admin` or `root_admin` role.
2. Navigate to the **Profiles** tab.
3. Select the **Nexus Admin Panel** button.

The dashboard provides tools to:
- **Initialize the Realm**: Claim the root throne on fresh environments.
- **Entity Oversight**: Search, identify, and manage user roles.
- **System Sanitization**: Irreversibly purge all entities (Root Admin only).

---

## Testing

This project maintains a robust, multi-layered testing strategy to ensure the integrity of its zero-trust microservice architecture.

### 1. Frontend Unit & Hook Tests (Jest)
Tests individual React hooks and logic in isolation using mocked API responses.
- **What it does**: Validates UI state transitions, error handling, and business logic without a running backend.
- **Test coverage**: Login, profile creation, swiping, messages, navigation, optimistic updates, portfolio navigation, and UI snapshots.
- **Run**:
  ```bash
  cd frontend
  npm test
  ```

### 2. System Integration Tests (Python/Pytest)
Service-to-service integration tests targeting the backend REST APIs.
- **What it does**: Validates complex backend workflows like discovery filtering and cross-service data consistency.
- **Run (Local)**:
  ```bash
  bash tests/run_integration_tests.sh
  ```
- **Run (Cloud)**:
  ```bash
  bash tests/run_cloud_integration_tests.sh
  ```

### 3. Mobile UI Integration (Maestro) — *Planned / Future*
Native mobile automation for React Native.
- **What it will do**: Simulate real touch interactions on an Android/iOS emulator and verify UI elements.
- **Status**: Planned for future implementation.

---

## CI/CD (Cloud Build)

Automated build and deployment is managed via **Google Cloud Build** triggers.

### Backend Services
Each backend service uses a shared Cloud Build config at [`services/cloudbuild.yaml`](services/cloudbuild.yaml):
1. Runs unit tests (`pytest`) inside a Python 3.12 container.
2. Builds and pushes a Docker image to GCR.
3. Deploys to Cloud Run with the appropriate environment suffix (`-dev` or `-test`).

### Frontend
The frontend uses its own Cloud Build config at [`frontend/cloudbuild.yaml`](frontend/cloudbuild.yaml):
1. Runs Jest unit tests.
2. Fetches backend Cloud Run URLs for the target environment.
3. Builds an Expo web bundle inside a Docker image with injected env vars.
4. Deploys the containerized frontend to Cloud Run.

---

## Deployment

All deployments are automated via **Google Cloud Build** pipelines linked to GitHub. Push to `main` to trigger builds for both backend services and the frontend.

---

## Frontend (React Native)

The frontend uses **Expo** and the **Stitch Design System**.

```bash
cd frontend
npm install
npx expo start
```

> [!IMPORTANT]
> **Directory Context**: All `npm`, `npx`, and `jest` commands MUST be executed from within the `frontend/` directory. Running these from the project root will fail.

### No Direct Firestore Access
The frontend must never call Firestore directly. All data must be fetched through the microservice APIs. The client SDK is only authorized to use the Firebase Authentication module.

### Environment Switching
Easily toggle the frontend between local, dev (cloud), and test (cloud) environments:
```bash
bash scripts/switch_env.sh [local|dev|test]
```
