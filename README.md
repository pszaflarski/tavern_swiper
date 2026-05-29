# The Tavern Swipes — Tavern Swiper

> *"Every interaction should feel like a discovery."*

A fantasy-themed dating app with a **strictly isolated, zero-trust microservice backend** and a React Native (Expo) frontend.

---

## 🚀 Quick Start

Get the full backend running locally in 5 steps:

```bash
# 1. Clone and enter the project
git clone https://github.com/pszaflarski/tavern_swiper.git
cd tavern_swiper

# 2. Set up GCP credentials (one-time — see "Truly Keyless Configuration" below)
gcloud auth application-default login \
  --impersonate-service-account=tavern-swiper-sa@tavern-swiper-dev.iam.gserviceaccount.com

# 3. Create .env files from templates
for dir in services/auth/auth_go services/auth/users_go services/profiles/profiles_go \
           services/discovery/discovery_go services/messages/messages_go services/router/router_go; do
    cp "$dir/.env.example" "$dir/.env"
done
cp frontend/.env.example frontend/.env
# Then edit each .env to fill in real values (JWT_SECRET, Firebase keys, etc.)

# 4. Start the backend
docker compose up --build

# 5. Start the frontend (separate terminal)
cd frontend
npm install
npx expo start
```

> [!IMPORTANT]
> **Step 3 is critical.** All `.env` files are gitignored for security. You must create them from the `.env.example` templates. See the [Environment Variables](#environment-variables) section for details.

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

- **6 Core Services**: Auth, Profiles, Discovery, Messages, Users, Router — all Go/Gin.
- **2 Event Workers**: `discovery_subscriber`, `messages_subscriber` — maintain local caches via Pub/Sub.
- **Event-Driven**: Profile updates and match events propagate via **Google Cloud Pub/Sub** with **Protobuf** serialization.
- **Granular Tagging**: A centralized `tags` collection supports filterable attributes (Race, Fandom, Interests) with case-insensitive search and denormalized storage on profiles.
- **Database Isolation**: 12 distinct Firestore databases (6 for `dev`, 6 for `test`).
- **Truly Keyless**: Local development and Cloud Run deployments use **IAM Impersonation** instead of static service account keys.

For full details, see [docs/architecture.md](docs/architecture.md).

---

## Local Setup & Identity

### 1. Prerequisites
- Docker & Docker Compose v2
- Google Cloud SDK (`gcloud`)
- A Google Cloud Project (`tavern-swiper-dev`)
- Go 1.25+ (for backend development)
- Node.js 18+ and npm (for frontend development)
- Python 3.10+ (for administrative scripts and integration testing)

### 2. Virtual Environment (Strict Isolation)
To ensure dependency consistency across administrative scripts, always use the project's root virtual environment:
```bash
# Create the environment (one-time)
python3 -m venv .venv

# Always activate before running any python scripts or pip commands
source .venv/bin/activate

# Install all dependencies (admin scripts + integration tests)
pip install -r scripts/requirements.txt
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

### 4. Environment Variables

All `.env` files are **gitignored** for security. Each service ships a `.env.example` template that must be copied and filled in.

```bash
# Copy all templates at once
for dir in services/auth/auth_go services/auth/users_go services/profiles/profiles_go \
           services/discovery/discovery_go services/messages/messages_go services/router/router_go; do
    cp "$dir/.env.example" "$dir/.env"
done
cp frontend/.env.example frontend/.env
```

> [!IMPORTANT]
> **JWT_SECRET**: All backend services **must** share the same `JWT_SECRET` value. This enables local JWT verification — each service validates tokens independently using a shared HMAC secret, avoiding per-request calls to the Auth service.
>
> For local development, use any strong random string. For production, secrets are managed via Google Cloud Secret Manager and injected through Cloud Build substitution variables.

| Variable | Where | Description |
| :--- | :--- | :--- |
| `JWT_SECRET` | All services | Shared HMAC secret for Tavern JWT signing/verification. **Must be identical across all services.** |
| `FIREBASE_WEB_API_KEY` | `auth_go`, `frontend` | Firebase project Web API key (from Firebase Console). |
| `FIRESTORE_DATABASE_ID` | Each service | Environment-specific DB name (e.g., `profiles-dev`, `discovery-dev`). |
| `GCS_BUCKET_NAME` | `profiles_go` | GCS bucket for profile images (e.g., `tavern-swiper-dev-media-dev`). |
| `PUBSUB_TOPIC_ID` | `profiles_go`, `discovery_go` | Pub/Sub topic names for event publishing. |

### 5. Start the Backend (Docker)
From the root directory:
```bash
docker compose up --build
```
*Note: Containers dynamically listen on the port provided by the `$PORT` environment variable.*

### 6. AI Agent Standalone Debug Server (Python)
If you only need to test the LLM agents (`grogmar` and `lira`) and their quest/checkpoint tool-calling flows without booting the entire microservice stack:
```bash
.venv/bin/python3 services/agent_router/debug_server.py
```
For detailed UI interaction steps and verification instructions, see [services/agent_router/DEBUG.md](file:///home/peter/Documents/tavern_swiper/services/agent_router/DEBUG.md).

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

## 🛠️ Utility Scripts

Several convenience scripts are available in the `scripts/` directory to assist with development and testing:

| Script | Usage | Purpose |
| :--- | :--- | :--- |
| `clear_system.py` | `.venv/bin/python3 scripts/clear_system.py [dev/test]` | Purges Firestore and GCS data. Add `--clear-firebase` to also wipe Auth. |
| `delete_user.py` | `.venv/bin/python3 scripts/delete_user.py <email>` | Deletes a single identity from Firebase Auth by email. |
| `seed_profiles.py` | `.venv/bin/python3 scripts/seed_profiles.py [dev/test]` | Populates the realm with authentic sample hero identities. |
| `setup-databases.sh` | `bash scripts/setup-databases.sh [dev/test/prod]` | Creates all Firestore databases and applies indexes. |
| `switch_env.sh` | `bash scripts/switch_env.sh [local/dev/test]` | Switches frontend to point at a different backend environment. |

### Manual Database Creation

If you ever need to manually create a database for a new microservice, you **must** use the exact flags below. Failure to include `--enable-firestore-data-access` or setting the wrong type/edition will result in the database being created with MongoDB compatibility or as standard tier, which will break the application.

```bash
gcloud firestore databases create --database="<db-name>-<env>" \
  --location="us-central1" \
  --type=firestore-native \
  --edition=enterprise \
  --enable-firestore-data-access \
  --enable-realtime-updates \
  --project="tavern-swiper-dev"
```
*(Note: Replace `us-central1` with `nam5` for the `prod` environment)*

> **⚠️ CRITICAL INDEXING BEHAVIOR**
> Firestore Enterprise Native has **NO DEFAULT INDEXES**. Unlike Firestore Standard, which automatically creates single-field indexes, Enterprise requires *every* queried field (even simple `==` lookups) to have an explicit index created via `gcloud firestore indexes composite create`. Always run `./scripts/apply-indexes.sh <env>` after creating a database, or all queries will fail.

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

### Environment & Identity

This project maintains three distinct deployment environments: `local`, `dev`, and `test`.

- **Isolated State**: Each environment uses its own set of dedicated Firestore databases (e.g., `profiles-dev` vs `profiles-test`).
- **Shared Identity (Project-Wide)**: All environments share a single **Firebase Auth** instance per project.
    - **Shared Accounts**: Your account (email/password) and uniquely generated **UID** are global.
    - **Password Changes**: Updating your password in `dev` will affect your login for `test`.
    - **Stability**: This allows characters to exist in both realms with the same identity, but completely different progress/profiles.

> [!WARNING]
> Clearing the "Firebase Auth users" via `scripts/clear_system.py --clear-firebase` is a **project-wide destructive action**. It will delete identities for all environments. By default, the script only clears environment-specific application state (Firestore/Storage) to preserve your UIDs.

### Environment Switching
Easily toggle the frontend between local, dev (cloud), and test (cloud) environments:
```bash
bash scripts/switch_env.sh [local|dev|test]
```
