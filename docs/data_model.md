# Tavern Swiper Data Models

This document outlines the Firestore collection schemas and data types used across the Tavern Swiper microservices.

## 🏰 Profiles Service
**Database ID**: `profiles`
**Collection**: `profiles`

| Field | Type | Description |
| :--- | :--- | :--- |
| `user_id` | `string` | The Firebase UID of the owner. |
| `display_name` | `string` | Public hero name. |
| `tagline` | `string` | Catchy hero phrase. |
| `bio` | `string` | Detailed hero backstory. |
| `image_urls` | `array<string>` | GCS URLs for portraits. |
| `gender` | `string` | Hero gender. |
| `is_active` | `boolean` | Whether this is the user's primary identity. |

---

## 🧭 Discovery Service
**Database ID**: `discovery`

### Collection: `swipes`
| Field | Type | Description |
| :--- | :--- | :--- |
| `swiper_profile_id` | `string` | ID of the profile doing the swiping. |
| `swiped_profile_id` | `string` | ID of the profile being swiped on. |
| `direction` | `string` | 'left' or 'right'. |
| `created_at` | `timestamp` | Time of action. |

### Collection: `matches`
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Deterministic ID: `match_{p1}_{p2}` (sorted). |
| `profiles` | `array<string>` | List of the two profile IDs. |
| `created_at` | `timestamp` | When the mutual match occurred. |

---

## 💬 Messages Service
**Database ID**: `messages`
**Collection**: `messages`

| Field | Type | Description |
| :--- | :--- | :--- |
| `match_id` | `string` | Reference to the Discovery match. |
| `sender_profile_id` | `string` | ID of the sender. |
| `content` | `string` | The message text. |
| `sent_at` | `timestamp` | Server-recorded time. |
| `participant_profile_ids` | `array<string>` | Denormalized list of participants for indexing. |

---

## 👤 Users Service
**Database ID**: `users`
**Collection**: `users`

| Field | Type | Description |
| :--- | :--- | :--- |
| `firebase_uid` | `string` | Primary key. |
| `email` | `string` | User email. |
| `role` | `string` | `user`, `admin`, or `root_admin`. |
| `is_premium` | `boolean` | Subscription status. |
| `user_type` | `string` | `user`, `admin`, or `root_admin`. |

---

## ⚙️ Firestore Index Requirements

Firestore requires **Composite Indexes** for any query that combines multiple fields in `where()` and `order_by()`, or uses specific operators like `array-contains` with ordering.

### Required Composite Indexes
If you disable "In-Memory Sorting" in the services, you MUST provision these indexes manually or via `firestore.indexes.json`.

| Service | Collection | Fields | Mode | Reason |
| :--- | :--- | :--- | :--- | :--- |
| `Messages` | `messages` | `match_id` (ASC), `sent_at` (ASC) | Composite | Historical history retrieval. |
| `Messages` | `messages` | `participant_profile_ids` (ARRAY), `sent_at` (DESC) | Composite | Conversation list (Inbox). |

> [!IMPORTANT]
> **In-Memory Sorting Workaround**: To ensure immediate stability in fresh environments (like automated integration tests), some services have been configured to perform sorting in the application layer. This bypasses the need for index provisioning but should be reverted to server-side sorting for massive datasets.

### Provisioning via gcloud
To manually create the required index for testing history retrieval:
```bash
gcloud firestore indexes composite create \
  --database=messages-test \
  --collection-group=messages \
  --field-config=field-path=match_id,order=ascending \
  --field-config=field-path=sent_at,order=ascending
```

---

## 📂 Database Isolation Pattern

This project uses **Database-per-Service** isolation. In Google Cloud, this is achieved by creating multiple Firestore databases within the same project.

- **Dev Suffix**: (none) e.g., `profiles`, `messages`.
- **Test Suffix**: `-test` e.g., `profiles-test`, `messages-test`.

Each service is injected with the `FIRESTORE_DATABASE_ID` environment variable at runtime.
