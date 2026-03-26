# The Tavern Swipes — Trystr

> *"Every interaction should feel like a discovery."*

A fantasy-themed dating app with a fully-isolated microservice backend and a React Native (Expo) frontend.

---

## Architecture

```
tavern_swiper/
├── docker-compose.yml
├── credentials/              ← place service-account.json here (git-ignored)
├── services/
│   ├── auth/                 (port 8001)  Firebase JWT verification
│   ├── profiles/             (port 8002)  Character profile CRUD + GCS image upload
│   ├── discovery/            (port 8003)  Swipe feed (calls profiles + swipes)
│   ├── swipes/               (port 8004)  Swipe recording + match creation
│   └── messages/             (port 8005)  Messaging (enforces match-gate)
└── frontend/                 React Native (Expo)
```

Each service is **completely isolated**:
- Its own `models.py`, `requirements.txt`, `Dockerfile`
- Its own Firestore collection(s)
- Deployable independently with `docker build`

---

## Local Setup

### 1. Prerequisites
- Docker & Docker Compose v2
- A Firebase project with Firestore enabled
- A Firebase service account JSON

### 2. Add credentials

```bash
mkdir -p credentials
cp /path/to/your/service-account.json credentials/service-account.json
```

> ⚠️  `credentials/` is git-ignored. Never commit your service account.

### 3. (Optional) Set GCS bucket for image uploads

```bash
echo "GCS_BUCKET_NAME=your-gcs-bucket-name" > .env
```

### 4. Start all services

```bash
docker compose up --build
```

Services will start with health checks. Discovery and Messages wait for their upstream dependencies before starting.

### 5. Service URLs

| Service    | URL                                |
|------------|------------------------------------|
| Auth       | http://localhost:8001/docs         |
| Profiles   | http://localhost:8002/docs         |
| Discovery  | http://localhost:8003/docs         |
| Swipes     | http://localhost:8004/docs         |
| Messages   | http://localhost:8005/docs         |

Each service exposes interactive Swagger UI at `/docs`.

---

## 5. Starting the Frontend

The frontend is a React Native (Expo) app. To run it:

```bash
cd frontend
npm install
npx expo start
```

### Connecting to the Backend

The app uses **Axios** (configured in `frontend/lib/api.ts`) to talk to the services. 

- **Local Emulator**: A `.env` file has been **pre-configured** for you in the `frontend/` directory with localhost URLs. It works out of the box.
- **Physical Device**: If testing on a real phone (Expo Go), you must update the `frontend/.env` variables to your machine's **LAN IP** (e.g., `http://192.168.1.XX:8001`). 

Your `frontend/.env` is currently set to:
```env
EXPO_PUBLIC_AUTH_URL=http://localhost:8001
EXPO_PUBLIC_PROFILES_URL=http://localhost:8002
EXPO_PUBLIC_DISCOVERY_URL=http://localhost:8003
EXPO_PUBLIC_SWIPES_URL=http://localhost:8004
EXPO_PUBLIC_MESSAGES_URL=http://localhost:8005
```

---

## 6. Enabling Live Data

The app currently uses **demo data** in `app/(tabs)/index.tsx` to ensure it renders immediately. To switch to the real backend:

1. Open `frontend/app/(tabs)/index.tsx`.
2. Uncomment the `useDiscovery` and `useSwipe` hooks.
3. Replace the `profiles` state with the data from the hooks.
