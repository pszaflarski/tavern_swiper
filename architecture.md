# Tavern Swiper Architecture Analysis

This document provides a technical overview of the Tavern Swiper application, covering both the frontend and backend microservices, infrastructure, and cross-service communication.

## 1. System Overview

Tavern Swiper is a hero-discovery application where users "forge" identities and discover other heroes (swipe). It consists of a **React Native (Expo)** frontend and a **Python (FastAPI)** backend composed of six microservices.

### Backend Microservices
All services are built with Python and FastAPI, utilizing Firestore for persistent storage.

| Service | Port | Responsibility |
| :--- | :--- | :--- |
| **Auth** | 8001 | Identity provider, Firebase account integration, and token verification. |
| **Profiles** | 8002 | Stores hero identities, attributes (Strength, Charisma, Spark), and portraits. |
| **Discovery** | 8003 | Logic for hero "feeds". Filters profiles based on matches and swipes. |
| **Swipes** | 8004 | Persistent storage for swipe actions (left/right) and match detection. |
| **Messages** | 8005 | Real-time messaging and chat history between matched heroes. |
| **Users** | 8006 | General user metadata (premium status, active profile ID, roles). |

---

## 2. Infrastructure & Data Persistence

### Database: Cloud Firestore
- **NoSQL Schema**: High flexibility for profile attributes and changing game mechanics.
- **Shared Access**: All microservices connect to the same Firestore project but are logically separated by collections (`profiles`, `users`, `swipes`, `messages`).
- **Media**: Profile portraits are stored in **Google Cloud Storage** (GCS), managed by the `profiles` service.

### Orchestration: Docker Compose
- **Local Dev**: Each service runs in a container on a shared `tavern-net` network.
- **Hot Reloading**: Persistent volumes map source code into containers for real-time development.

---

## 3. Communication Patterns

### Frontend to Backend
- **Bearer Authentication**: The frontend obtains an ID token from Firebase directly and injects it into every request header.
- **Service Hub**: The frontend communicates with services via a unified API client in `frontend/lib/api.ts` using configured base URLs.

### Service to Service
- **Token Verification**: Downstream services (e.g., Discovery) call `GET /auth/verify` to validate credentials.
- **Synchronous REST**: Services use `httpx` for inter-service communication (e.g., Discovery calls Profiles for hero data).

---

## 4. Frontend Architecture (React Native/Expo)

- **Navigation**: Filesystem-based routing via `Expo Router` with a tab-based primary layout.
- **State Management**: 
    - **React Query**: Handles server state, caching, and background synchronization for profiles and discovery feeds.
    - **Context API**: Manages global UI states like the `ActiveProfileContext`.
- **Styling**: A centralized `theme` directory handles colors, typography, and spacing consistency.

---

## 5. Proposed Cleanup & Next Steps

### Phase 1: Environment & Service Standardization (Completed)
- [x] **Isolated Environment Profiles**: Each service maintains its own `.env` file, ensuring complete isolation while following a standardized internal layout (SERVICE_NAME, SERVICE_PORT, etc.).
- [x] **Fixed Internal Connectivity**: All services now consistently point to `http://auth:8001` for internal authentication verification, resolving previous "localhost" vs "auth" inconsistencies.
- [x] **Surfaced Infrastructure Config**: Variables like `USERS_DATABASE_ID` are now explicitly defined in the relevant `.env` files rather than being injected by external scripts.

### Phase 2: Configuration & Admin (Completed)
- [x] **Modernize Admin Tooling**: Retired the standalone `admin.html` and integrated admin-only routes directly into the React Native app.
- [x] **Nexus Admin Panel**: Implemented a protected `/admin` route with role-based access control (`admin`, `root_admin`).
- [x] **System Initialization**: Ported the "Claim the Root" initialization flow to the mobile experience for fresh environments.

### Phase 3: Performance & Robustness (Long Term)
- [ ] **Asynchronous Matching**: Move match detection (currently in the Swipes service) to an asynchronous worker to reduce latency during a swipe.
- [ ] **API Gateway**: Introduce a lightweight API gateway (like Kong or Nginx) to handle cors, rate limiting, and centralized logging.
