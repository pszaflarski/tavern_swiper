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

## Key Flows

### Swipe → Match → Message
1. `POST /swipes/` — record a right swipe
2. If the other profile already swiped right → a Match is created automatically
3. `POST /messages/` — send a message (403 if no match exists)

### Profile with Image
1. `POST /profiles/` — create profile
2. `POST /profiles/{id}/image` — upload to GCS, URL saved to Firestore

---

## Deploying a Single Service

Each service can be built and deployed independently:

```bash
cd services/profiles
docker build -t trystr-profiles .
docker run -p 8002:8002 \
  -e GOOGLE_APPLICATION_CREDENTIALS=/creds/sa.json \
  -e GCS_BUCKET_NAME=my-bucket \
  -v /path/to/sa.json:/creds/sa.json \
  trystr-profiles
```
