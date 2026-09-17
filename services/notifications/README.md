# Notifications Service Boundary

The Notifications boundary manages real-time push notifications, device FCM token registration, and in-app activity alert history for Tavern Swiper.

---

## 1. Architectural Taxonomy & Principles

### Principle 1: Interaction Exclusively Through Explicit Contracts
Client notifications and device registration use versioned OpenAPI REST contracts (`/notifications`). Event-driven push notifications are triggered by versioned Protobuf contracts (`proto/match_events.proto` and `proto/message_events.proto`).

### Principle 2: Defined Business Purpose (Bounded Context)
- **Bounded Context**: Push notification dispatch (via Firebase Cloud Messaging / Expo), device push token management, in-app notification inbox history, and unread notification counter management.
- **Domain Invariants**: Device tokens are linked to active user accounts; event notifications are deduplicated to prevent redundant alert spam.

### Principle 3: Complete Autonomy of Operational Data
- **Autonomous Persistence Engine**: Dedicated Firestore database `notifications-{env}` (Collections: `notifications`, `device_tokens`).
- **Isolation Constraint**: External microservices cannot modify `notifications-{env}` directly. Alert records are created via `notifications_go` REST endpoints or ingested via `notifications_subscriber`.

---

## 2. The Three Interfaces (3D Architecture)

| Interface Dimension | Target Access Pattern | Typical Protocols / Formats | Primary Purpose & Container Implementation |
|---|---|---|---|
| **1. Synchronous Operational (OLTP)** | Device token registration, in-app inbox retrieval, mark-as-read updates | REST (OpenAPI / Swagger via Gin) | `notifications_go` (:8014) handles FCM token updates (`POST /notifications/device-token`), inbox fetching (`GET /notifications`), and alert status toggles. |
| **2. Analytical Query (OLAP)** | Push delivery conversion rates, click-through statistics, notification open rates | Materialized Views / Analytical exports | Notification analytics modules aggregate push delivery metrics and campaign open rates for product analytics. |
| **3. Asynchronous Streaming (Events)** | Automated event-driven push dispatch (matches & messages) | GCP Pub/Sub (Protobuf schemas) | `notifications_subscriber` (:8015) listens to `{env}-discovery-match-events-v1` and `{env}-messages-message-events-v1` to send push notifications. |

---

## 3. Position in the System & Event Flow

```
┌───────────────────┐                           ┌────────────────────────────────────────┐
│ Discovery Boundary│  Pub/Sub (match events)    │         Notifications Boundary         │
│   discovery_go    │ ─────────────────────────→ │  ┌──────────────────────────────────┐  │
└───────────────────┘                            │  │ notifications_subscriber :8015   │  │
                                                 │  │ - Generates match push alerts    │  │
┌───────────────────┐                            │  │ - Generates message push alerts  │  │
│ Messages Boundary │  Pub/Sub (message events)  │  └──────────────┬───────────────────┘  │
│   messages_go     │ ─────────────────────────→ │                 │ dispatches           │
└───────────────────┘                            │                 ▼                      │
                                                 │       ┌───────────────────┐            │
                                                 │       │ Push Provider     │            │
                                                 │       │ (FCM / Expo Push) │            │
                                                 │       └───────────────────┘            │
                                                 │  ┌──────────────────────────────────┐  │
                                                 │  │ notifications_go  :8014         │  │
                                                 │  │ owns: notifications,             │  │
                                                 │  │   device_tokens                  │  │
                                                 │  └──────────────────────────────────┘  │
                                                 └────────────────────────────────────────┘
```

---

## 4. Physical Containers

### `notifications_go` — Notifications API (OLTP)
Manages push device token registration and in-app notification inbox history.
- **Port**: `8014`
- **Base path**: `/notifications`
- **Database**: `notifications-{env}`
- **Key endpoints**:
  - `POST /notifications/device-token` — Register device push token (FCM/Expo)
  - `GET /notifications/` — Get in-app notifications for authenticated user
  - `PATCH /notifications/{id}/read` — Mark notification as read
  - `DELETE /notifications/{id}` — Delete notification record

### `notifications_subscriber` — Event Notification Subscriber (Events)
Listens to system Pub/Sub event streams and dispatches real-time push alerts to user devices.
- **Port**: `8015`
- **Subscribes to**:
  - `{env}-discovery-match-events-v1` — Dispatches "New Match!" push alerts when mutual swipes occur
  - `{env}-messages-message-events-v1` — Dispatches "New Message from [Hero]" push alerts when a chat message arrives

---

## 5. Cross-Service Dependencies & Events

### Subscribed Events:
| Event Topic | Source Service | Purpose |
|---|---|---|
| `{env}-discovery-match-events-v1` | `discovery_go` | Triggers match push notifications |
| `{env}-messages-message-events-v1` | `messages_go` | Triggers chat message push notifications |

### External Dependencies:
| Dependency | Purpose | Protocol |
|---|---|---|
| **FCM / Expo Push Service** | Remote push delivery | HTTP API call to Firebase Cloud Messaging |

---

## 6. Data Model

**Database**: `notifications-{env}`

### Collection: `notifications`
| Field | Type | Description |
|---|---|---|
| `id` | string | Notification ID |
| `user_id` | string | Target user UID |
| `title` | string | Alert title |
| `body` | string | Alert payload text |
| `type` | string | `match`, `message`, `system` |
| `is_read` | bool | Read status flag |
| `created_at` | timestamp | Timestamp |

### Collection: `device_tokens`
| Field | Type | Description |
|---|---|---|
| `user_id` | string | User UID |
| `token` | string | FCM / Expo push token string |
| `platform` | string | `ios`, `android`, `web` |
| `updated_at` | timestamp | Server update timestamp |

---

## 7. Running & Testing

### Docker Compose
```bash
docker compose up notifications notifications-subscriber
```

### Air Hot-Reload
```bash
cd services/notifications/notifications_go && air
cd services/notifications/notifications_subscriber && air
```

### Unit Tests
```bash
cd services/notifications/notifications_go && go test -v ./...
cd services/notifications/notifications_subscriber && go test -v ./...
```
