# The Tavern Swipes — Tavern Swiper

> *"Every interaction should feel like a discovery."*

A fantasy-themed dating app with a **strictly isolated, zero-trust microservice backend** and a React Native (Expo) frontend.

---

## Documentation

| Document | Description |
| :--- | :--- |
| [Architecture](docs/architecture.md) | System overview, service map, Pub/Sub events, match lifecycle |
| [Data Model](docs/data_model.md) | Firestore collection schemas and index requirements |
| [Testing](docs/testing.md) | Unit, integration, and UI testing guide |
| [Deployment](docs/deployment.md) | CI/CD pipelines and pre-push checklist |
| [Keyboard Handling](docs/patterns/keyboard-handling.md) | Gold standard for mobile keyboard UX |
| [Swagger Proposal](docs/proposals/go-swagger.md) | OpenAPI documentation plan for Go services |

---

## Architecture at a Glance

This project follows a "Shared Nothing" microservice architecture. Each service is a completely self-contained unit with its own logic, dependencies, and **dedicated Firestore database instance**.

- **5 Core Services**: Auth, Profiles, Discovery, Messages, Users — all Go/Gin.
- **2 Event Workers**: `discovery_subscriber`, `messages_subscriber` — maintain local caches via Pub/Sub.
- **Event-Driven**: Profile updates and match events propagate via **Google Cloud Pub/Sub** with **Protobuf** serialization.
- **Database Isolation**: 10 distinct Firestore databases (5 for `dev`, 5 for `test`).
- **Truly Keyless**: Local development and Cloud Run deployments use **IAM Impersonation** instead of static service account keys.

For full details, see [docs/architecture.md](docs/architecture.md).

---

## Local Setup & Identity

### 1. Prerequisites
- Docker & Docker Compose v2
- Google Cloud SDK (`gcloud`)
- A Google Cloud Project (`tavern-swiper-dev`)
- Go 1.25+ (for backend development)
- Python 3.10+ (for administrative scripts and integration testing)

### 2. Virtual Environment (Strict Isolation)
To ensure dependency consistency across administrative scripts, always use the project's root virtual environment:
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
*Note: Containers dynamically listen on the port provided by the `$PORT` environment variable.*

---

## ⚙️ Firestore Indexing

This project uses advanced Firestore queries (e.g., matching + time-based sorting) that require **Composite Indexes**.

- **Automatic Workaround**: The services currently use in-memory sorting for testing and development to avoid immediate index requirements.
- **Production Requirement**: For large-scale data, you must provision composite indexes as documented in [docs/data_model.md](docs/data_model.md#️-firestore-index-requirements).

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
