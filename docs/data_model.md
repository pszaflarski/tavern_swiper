# Tavern Swiper Data Models

This document outlines the Firestore collection schemas and data types used across the Tavern Swiper microservices.

## 🏰 Profiles Service
**Database ID**: `profiles`
**Collection**: `profiles`

| Field | Type | Description |
| :--- | :--- | :--- |
| `user_id` | `string` | The Firebase UID of the owner. |
| `display_name` | `string` | Public hero name. |
| `tagline` | `string` (optional) | Catchy hero phrase. |
| `bio` | `string` (optional) | Detailed hero backstory. |
| `image_urls` | `array<string>` | GCS URLs for portraits. |
| `gender` | `string` (optional) | Hero gender. |
| `is_active` | `boolean` | Whether this is the user's primary identity. |
| `created_at` | `timestamp` | Server-side timestamp set on creation. |
| `updated_at` | `timestamp` | Server-side timestamp updated on every change. |

---

## 🧭 Discovery Service
**Database ID**: `discovery`

### Collection: `swipes`
| Field | Type | Description |
| :--- | :--- | :--- |
| `swiper_profile_id` | `string` | ID of the profile doing the swiping. |
| `swiped_profile_id` | `string` | ID of the profile being swiped on. |
| `direction` | `string` | `'left'` or `'right'`. |
| `created_at` | `timestamp` | Server-side timestamp of action. |
| `modified_at` | `timestamp` | Server-side timestamp of last modification. |
| `is_deleted` | `boolean` | Soft-delete flag. |

### Collection: `matches`
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Deterministic ID: `match_{p1}_{p2}` (sorted). |
| `profiles` | `array<string>` | List of the two profile IDs. |
| `created_at` | `timestamp` | Server-side timestamp of when the mutual match occurred. |

### Cache Collection: `profiles_profiles_cache`
A local read-cache of profile data populated by the `discovery_subscriber` via Pub/Sub events from the Profiles service.

---

## 💬 Messages Service
**Database ID**: `messages`

### Collection: `conversations`
Top-level collection representing a chat thread between two matched profiles.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Conversation UUID. |
| `participants_key` | `string` | Deterministic key: sorted `{pid1}_{pid2}` for deduplication. |
| `participant_ids` | `array<string>` | List of the two participant profile IDs. |
| `created_by` | `string` | Profile ID of the conversation initiator. |
| `created_at` | `timestamp` | Server-side timestamp of creation. |
| `updated_at` | `timestamp` | Server-side timestamp, updated on each new message. |
| `last_message_id` | `string` (optional) | ID of the most recent message. |
| `last_message_text` | `string` (optional) | Content preview of the most recent message. |
| `last_message_sent_at` | `timestamp` (optional) | When the last message was sent. |
| `last_message_sender_id` | `string` (optional) | Profile ID of the last message sender. |

### Sub-collection: `conversations/{id}/messages`
Messages are stored as a sub-collection under each conversation document.

| Field | Type | Description |
| :--- | :--- | :--- |
| `sent_by` | `string` | Profile ID of the sender. |
| `content` | `string` | The message text. |
| `created_at` | `timestamp` | Server-side timestamp. |
| `updated_at` | `timestamp` | Server-side timestamp. |

### Collection: `profile_conversations`
A lookup/mapping collection enabling efficient per-profile conversation queries.

| Field | Type | Description |
| :--- | :--- | :--- |
| `profile_id` | `string` | The profile this mapping belongs to. |
| `conversation_id` | `string` | Reference to the parent conversation. |
| `role` | `string` | Participant role (currently always `"participant"`). |

> [!NOTE]
> Document IDs in `profile_conversations` use the format `{profile_id}_{conversation_id}` for deterministic lookup.

### Cache Collection: `discovery_matches_cache`
A local read-cache of match data populated by the `messages_subscriber` via Pub/Sub events from the Discovery service. Used to verify that a match exists before allowing conversation creation.

---

## 👤 Users Service
**Database ID**: `users`
**Collection**: `users`

| Field | Type | Description |
| :--- | :--- | :--- |
| `email` | `string` | User email. |
| `user_type` | `string` | `user`, `admin`, or `root_admin`. |
| `is_premium` | `boolean` | Subscription status. |
| `is_deleted` | `boolean` | Soft-delete flag. |
| `created_at` | `timestamp` | Server-side timestamp of creation. |

---

## ⚙️ Firestore Index Requirements

Firestore requires **Composite Indexes** for any query that combines multiple fields in `where()` and `order_by()`, or uses specific operators like `array-contains` with ordering.

### Required Composite Indexes
If you disable "In-Memory Sorting" in the services, you MUST provision these indexes manually or via `firestore.indexes.json`.

| Service | Collection | Fields | Mode | Reason |
| :--- | :--- | :--- | :--- | :--- |
| `Discovery` | `matches` | `profiles` (ARRAY), `created_at` (DESC) | Composite | Listing matches for a profile. |

> [!IMPORTANT]
> **In-Memory Sorting Workaround**: To ensure immediate stability in fresh environments (like automated integration tests), some services have been configured to perform sorting in the application layer. This bypasses the need for index provisioning but should be reverted to server-side sorting for massive datasets.

### Provisioning via gcloud
To manually create a required index:
```bash
gcloud firestore indexes composite create \
  --database=discovery-test \
  --collection-group=matches \
  --field-config=field-path=profiles,array-config=CONTAINS \
  --field-config=field-path=created_at,order=descending
```

---

## 📂 Database Isolation Pattern

This project uses **Database-per-Service** isolation. In Google Cloud, this is achieved by creating multiple Firestore databases within the same project.

- **Dev Suffix**: (none) e.g., `profiles`, `messages`.
- **Test Suffix**: `-test` e.g., `profiles-test`, `messages-test`.

Each service is injected with the `FIRESTORE_DATABASE_ID` environment variable at runtime.
