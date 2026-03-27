# The Tavern Swipes — Trystr

> *"Every interaction should feel like a discovery."*

A fantasy-themed dating app with a **strictly isolated, zero-trust microservice backend** and a React Native (Expo) frontend.

---

## Architecture

This project follows a "Shared Nothing" microservice architecture. Each service is a completely self-contained unit with its own logic, dependencies, and **dedicated Firestore database instance**.

```
tavern_swiper/
├── docker-compose.yml
├── credentials/              ← place service-account.json here (git-ignored)
├── services/
│   ├── auth/                 (port 8001)  Identity Verification & Login REST API
│   ├── profiles/             (port 8002)  Character profile CRUD + GCS uploads
│   ├── discovery/            (port 8003)  The Swipe Feed (orchestrator)
│   ├── swipes/               (port 8004)  Matching & Swipe recording
│   ├── messages/             (port 8005)  Match-gated Messaging
│   └── users/                (port 8006)  User metadata & management
└── frontend/                 React Native (Expo) + Stitch Design System
```

### Core Constraints
1. **Strict Database Isolation**: Every service points to its own unique Firestore database (e.g., `profiles`, `swipes`, `users`). 
2. **Local Configuration**: Services load their own environment from local `.env` files within their respective `services/X/` directories.
3. **Internal Auth**: No service trusts a request unless the `auth` microservice verifies the Firebase ID token.

---

## Local Setup

### 1. Prerequisites
- Docker & Docker Compose v2
- A Google Cloud Project with Billing enabled
- **6 Native Firestore Databases** named: `auth`, `profiles`, `discovery`, `swipes`, `messages`, `users`
- A Firebase Web API Key (found in Firebase Console Settings)

### 2. Environment Configuration
Each microservice in `services/` contains its own `.env` file. You must ensure `GOOGLE_APPLICATION_CREDENTIALS` points to your service account path inside the container.

In `services/auth/.env`:
```env
FIREBASE_WEB_API_KEY=your_key_here
FIRESTORE_DATABASE_ID=auth
GOOGLE_APPLICATION_CREDENTIALS=/credentials/service-account.json
```

### 3. Start the Backend
From the root directory:
```bash
docker compose up --build
```

### 4. Running Backend Tests
We provide a unified test runner that executes the isolated test suites for all 6 services:
```bash
bash services/run_tests.sh
```

---

## Service URLs (Swagger Docs)

| Service    | URL                                | Function                           |
|------------|------------------------------------|------------------------------------|
| **Auth**   | http://localhost:8001/docs         | Login/Register/Verify              |
| **Profiles**| http://localhost:8002/docs         | Character Management               |
| **Discovery**| http://localhost:8003/docs        | Swipe Feed Generation              |
| **Swipes**  | http://localhost:8004/docs         | Recording Matches                  |
| **Messages**| http://localhost:8005/docs         | Chat & Match Validation            |
| **Users**   | http://localhost:8006/docs         | Account Metadata                   |

### Special Endpoints
The `auth` service provides programmatic login for testing:
*   `POST /auth/login`: Exchanges email/password for a real Firebase ID token.
*   `POST /auth/register`: Exchanges email/password for a new user and returns a token.

---

## 5. Starting the Frontend (React Native)

The frontend uses **Expo** and the **Stitch Design System**.

```bash
cd frontend
npm install
npx expo start
```

### Frontend Configuration
The frontend uses a centralized `.env` file in the `frontend/` directory to map localhost ports to the microservice fleet. Ensure `EXPO_PUBLIC_FIREBASE_API_KEY` is set to your Firebase Web API Key.

---

## 6. Development Workflow
1. **UI Components**: Check `frontend/components/` for Stitch-based UI (e.g., `SwipeDeck`, `CharacterProfile`).
2. **Hooks**: Data fetching is handled by custom hooks in `frontend/hooks/` which utilize the token-injected Axios client in `lib/api.ts`.
3. **Adding a Feature**:
   - Update the specific microservice's `main.py` and `models.py`.
   - Update its local `.env` if new variables are needed.
   - Run `services/run_tests.sh` to ensure no zero-trust boundaries were broken.
