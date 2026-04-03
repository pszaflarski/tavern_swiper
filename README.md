# The Tavern Swipes — Tavern Swiper

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

### 3. Start the Backend (Docker)
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
- **Run**:
  ```bash
  cd frontend
  npm test
  ```

### 2. Frontend Web Integration (Playwright) — [RECOMMENDED]
True end-to-end tests that run the frontend in a browser against local or cloud services.
- **What it does**: 
    - Performs an automated database wipe of `-test` databases via a cleanup script.
    - Executes real user flows (Signup, Profile Forge) in the web browser.
    - Captures the session token and **verifies results directly via backend REST APIs** to ensure frontend-backend synchronization.

  > **Note on E2E Stability**: Due to backend microservice cold-starts and eventual consistency of Firestore indexing, these tests employ robust auto-waiting declarative assertions. Avoid hardcoded waits or aggressive page reloads in test suites.
  ```bash
  cd frontend
  npm run test:e2e
  ```

### 3. System Integration Tests (Python/Pytest)
Service-to-service integration tests targeting the backend REST APIs.
- **What it does**: Validates complex backend workflows like mutual matching, discovery filtering, and cross-service data consistency.
- **Run (Local)**:
  ```bash
  bash tests/run_integration_tests.sh
  ```
- **Run (Cloud)**:
  ```bash
  bash tests/run_cloud_integration_tests.sh
  ```

### 4. Mobile UI Integration (Maestro)
Native mobile automation for React Native.
- **What it does**: Simulates real touch interactions on an Android/iOS emulator and verifies UI elements.
- **Status**: Currently legacy/fallback due to stability issues in some environments.
- **Run (Local)**:
  ```bash
  bash tests/run_maestro_tests.sh
  ```
- **Run (Cloud)**:
  ```bash
  bash tests/run_cloud_maestro_tests.sh
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

### No Direct Firestore Access
The frontend must never call Firestore directly. All data must be fetched through the microservice APIs. The client SDK is only authorized to use the Firebase Authentication module.

### Environment Switching
Easily toggle the frontend between local, dev (cloud), and test (cloud) environments:
```bash
bash scripts/switch_env.sh [local|dev|test]
```
