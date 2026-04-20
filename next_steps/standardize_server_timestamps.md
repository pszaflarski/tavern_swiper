# Proposal: Standardizing Firestore Server-Side Timestamps

## Objective
Migrate all microservices from application-generated timestamps (`time.Now()`) to Firestore server-side timestamps (`firestore.ServerTimestamp`). This ensures a unified "source of truth" for time across the distributed system, regardless of which service or instance performs the write.

## Why this is a good idea
- **Clock Drift**: Microservices running in different containers or regions might have slight clock differences. Server-side timestamps eliminate this drift.
- **Consistency**: Guarantees that related writes across different services (e.g., Discovery creating a match and Messages receiving a cache event) are synchronized to the database's internal clock.
- **Precision**: Firestore server timestamps provide high precision and are used by Firestore internally for query ordering.
- **Reduced Complexity**: Services no longer need to worry about UTC normalization or RFC3339 formatting during the write phase.

## Current State Analysis

| Service | Collection | Fields | Current Strategy |
| :--- | :--- | :--- | :--- |
| **Messages** | `conversations` | `created_at`, `updated_at` | **Server-side (Migrated)** |
| **Messages** | `messages` | `created_at`, `updated_at` | **Server-side (Migrated)** |
| **Users** | `users` | `created_at` | Application-side (`_now()`) |
| **Discovery** | `swipes` | `created_at`, `modified_at` | Application-side (`_now()`) |
| **Discovery** | `matches` | `created_at` | Application-side (`_now()`) |
| **Profiles** | `profiles` | None | **Missing** |

## Implementation Strategy

### 1. Unified Write Pattern
To use `firestore.ServerTimestamp` in Go, the write operation must use a `map[string]interface{}` rather than a typed struct (unless the struct fields are changed to `interface{}`).

```go
// Standard Write Pattern
data := map[string]interface{}{
    "created_at": firestore.ServerTimestamp,
    "updated_at": firestore.ServerTimestamp,
    // ... other fields
}
client.Collection("collection").Doc(id).Set(ctx, data)
```

### 2. Standardizing the Profiles Service
The Profiles service currently lacks timestamps. This is the first candidate for implementation:
- Add `created_at` to the profile document on creation.
- Add `updated_at` to be updated via `firestore.Update` or `MergeAll` on every profile change (bio edit, image upload, activation switch).

### 3. Handling Responses
Since `ServerTimestamp` values are not known until *after* the write is committed, the immediate API response should:
- Use a local `time.Now()` as an approximation for the `SentAt` or `CreatedAt` field in the JSON response.
- Alternatively, refetch the document (though this adds latency). For most UI needs, an approximation in the response is sufficient as the "truth" is safely stored in the DB.

### 4. Supporting Local Testing
The `mock_firestore.go` in each service must be updated to intercept the `firestore.ServerTimestamp` sentinel and replace it with a local timestamp so that unit tests can still perform date assertions.

```go
// Mock Interceptor logic
if v == firestore.ServerTimestamp {
    d.data[k] = time.Now().UTC()
}
```

## Are there any "Bad Ideas" here?
- **Immediate Reading**: If a client expects the *exact* nanosecond from the DB immediately after a write without refetching, they might see a millisecond-level discrepancy between the response and the stored state.
- **Legacy Data**: We must ensure that our "Read" logic handles cases where old documents might have string-formatted dates or missing fields (using safe type assertions).

## Next Recommended Step
I recommend starting with the **Profiles Service**, as it is the most critical missing piece of the audit trail.
