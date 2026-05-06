# Router Service Boundary

The **Router** service is a service discovery registry for the Tavern Swiper ecosystem. It stores the Cloud Run URLs of all microservices, keyed by service name and environment/version tags (e.g., `default`, `preview`, `v1`, `latest`).

## Purpose
By querying the Router service instead of hardcoding service URLs in the frontend or other services, we can dynamically route traffic to specific versions or preview environments without redeploying consumers.

## API Summary
- `GET /router/services` - List all services for the `default` tag.
- `GET /router/services?tag=X` - List all services for tag `X`. Missing services return `null`.
- `GET /router/services/:name` - Get URL for a single service (default tag).
- `GET /router/services/:name?tag=X` - Get URL for a single service with tag `X`.
- `PUT /router/services/:name` - Upsert a service route (Admin only).
- `DELETE /router/services/:name?tag=X` - Delete a service route (Admin only).

## Architecture
- **Language**: Go (Gin Gonic)
- **Database**: Firestore (database ID: `router`)
- **Isolation**: Shared nothing boundary.

> [!NOTE]
> **Timestamp Behavior**: Due to the idempotent "upsert" strategy, `created_at` in the Firestore document is updated on every modification (behaves like `updated_at`). Use these timestamps for auditing last-modified times, not for determining the original registration date.
