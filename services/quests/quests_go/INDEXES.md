# Quests Service — Firestore Indexes

> **TODO**: Create these composite indexes before deploying to production.
> Firestore will auto-create single-field indexes, but composite queries require
> explicit index definitions.

## Pending Indexes

### `quest_status` collection

| Fields | Order | Query Pattern |
|--------|-------|---------------|
| `user_id` ASC, `quest_id` ASC | Composite | List all quest statuses for a user |
| `quest_id` ASC, `status` ASC | Composite | Find all users who completed a quest |

### `user_inventory` collection

| Fields | Order | Query Pattern |
|--------|-------|---------------|
| `user_id` ASC, `item_id` ASC | Composite | List inventory for a user |

### `quest_templates` collection

| Fields | Order | Query Pattern |
|--------|-------|---------------|
| `status` ASC, `sort_order` ASC | Composite | List active quests in order |

## Notes

- Single-field indexes on `user_id`, `quest_id`, `item_id`, `status` are auto-created.
- Monitor Cloud Console for "index required" errors in dev/test and add as needed.
- Batch all index creation before the prod deploy to minimize churn.
- Use `gcloud firestore indexes composite create` or the Firebase Console.
