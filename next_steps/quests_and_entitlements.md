# Quests & Entitlements — Implementation Plan

Two separate boundaries, built in two phases. Quests is a game mechanic (story-driven triggers and rewards). Entitlements is a future access control / commerce layer (subscriptions, premium, IAP) that can bypass quest triggers.

---

## Phase 1: Quests Boundary (Build First)

### 1.1 — Scaffold the Services

| Service | Port | Database |
|---------|------|----------|
| `quests_go` | 8011 | `quests-{env}` |
| `quests_subscriber` | 8012 | `quests-{env}` |

Create the standard file structure per AGENTS.md:
```
services/quests/
  quests_go/         main.go, handlers.go, models.go, auth.go, errors.go,
                     firestore.go, firestoreutil.go, mock_firestore.go,
                     handlers_test.go, docs/, Dockerfile, cloudbuild.yaml,
                     .env, .env.example
  quests_subscriber/ main.go, auth.go, proto/, Dockerfile, cloudbuild.yaml,
                     router_client.go, .env, .env.example
```

Register both services in the router (`router-{env}` Firestore).

### 1.2 — Firestore Schema (`quests-{env}`)

| Collection | Doc ID Pattern | Purpose |
|------------|---------------|---------|
| `quest_templates` | Auto-generated | Admin-defined quest definitions |
| `profile_quests` | `quest_{quest_id}_{profile_id}` | Per-profile progress |
| `quest_rewards` | `reward_{profile_id}_{quest_id}` | Rewards earned from completions |
| `quest_events` | Auto-generated | Idempotency / audit log |

### 1.3 — Quest Template Model

```go
type QuestTemplate struct {
    QuestID       string          `firestore:"quest_id"`
    Title         string          `firestore:"title"`
    Description   string          `firestore:"description"`
    NarrativeText string          `firestore:"narrative_text"`
    QuestType     string          `firestore:"quest_type"`     // daily, weekly, story, achievement
    Status        string          `firestore:"status"`         // draft, active, retired
    SortOrder     int             `firestore:"sort_order"`
    RewardType    string          `firestore:"reward_type"`    // badge, cosmetic, xp, unlock
    RewardPayload map[string]any  `firestore:"reward_payload"` // flexible reward data
    Triggers      []QuestTrigger  `firestore:"triggers"`
    CreatedAt     time.Time       `firestore:"created_at"`
    UpdatedAt     time.Time       `firestore:"updated_at"`
}

type QuestTrigger struct {
    EventType     string         `firestore:"event_type"`     // profile_created, match_made, message_sent
    RequiredCount int            `firestore:"required_count"` // e.g. 3
    Filters       map[string]any `firestore:"filters"`        // optional constraints
}
```

### 1.4 — API Endpoints (quests_go)

**Admin:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/quests/templates/` | Create quest template |
| `GET` | `/quests/templates/` | List all templates |
| `GET` | `/quests/templates/{id}` | Get template |
| `PUT` | `/quests/templates/{id}` | Update template |
| `DELETE` | `/quests/templates/{id}` | Retire template |

**Player:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/quests/profile/{profile_id}` | List quests + progress |
| `GET` | `/quests/profile/{profile_id}/available` | Quests not yet started |
| `POST` | `/quests/profile/{profile_id}/accept/{quest_id}` | Accept a quest |
| `POST` | `/quests/profile/{profile_id}/claim/{quest_id}` | Claim completed quest reward |
| `GET` | `/quests/rewards/profile/{profile_id}` | List earned rewards |

**Internal:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/quests/internal/trigger` | Process event trigger (from subscriber) |

### 1.5 — Pub/Sub Subscriptions (quests_subscriber)

Subscribe to existing topics — no changes to other services needed:

| Topic | Trigger Name |
|-------|-------------|
| `{env}-profiles-profile-events-v1` | `profile_created` |
| `{env}-discovery-match-events-v1` | `match_made` |
| `{env}-messages-message-events-v1` | `message_sent` |

Copy proto definitions from existing subscribers. Use subscription name to disambiguate event types (same pattern as `bots_subscriber`).

### 1.6 — Trigger Processing Flow

1. `quests_subscriber` receives Pub/Sub event
2. Deserializes protobuf, maps to trigger name + context
3. Calls `POST /quests/internal/trigger` on `quests_go`
4. `quests_go` queries `quest_templates` for active quests matching the trigger
5. For each matching quest, updates `profile_quests` progress
6. If all triggers satisfied → mark completed, write to `quest_rewards`

### 1.7 — Cloud Build & Deploy

- Add `cloudbuild.yaml` for both containers
- Create GCP Pub/Sub subscriptions pointing to `quests_subscriber` Cloud Run URL
- Register services in the router

### 1.8 — Frontend (Quest UI)

- Add quest log screen (or section in profile)
- React Query hooks: `useGetQuests`, `useClaimReward`
- Display quest progress bars, narrative text, reward previews

---

## Phase 2: Entitlements Boundary (Build Later)

### 2.1 — When to Build

Build when any of these become a requirement:
- Subscription / premium membership tiers
- In-app purchases (extra swipes, boosts)
- Premium users bypassing quest triggers
- Admin-granted access (promo codes, comp accounts)

### 2.2 — Service Layout

| Service | Port | Database |
|---------|------|----------|
| `entitlements_go` | 8013 | `entitlements-{env}` |

No subscriber initially — entitlements are granted via direct API calls.

### 2.3 — Firestore Schema (`entitlements-{env}`)

| Collection | Doc ID Pattern | Purpose |
|------------|---------------|---------|
| `entitlements` | `ent_{profile_id}_{entitlement_id}` | Active entitlements per profile |
| `entitlement_definitions` | `{entitlement_id}` | What entitlements exist |
| `entitlement_ledger` | Auto-generated | Append-only audit log |

### 2.4 — Entitlement Types

| Type | Source | Example |
|------|--------|---------|
| `badge` | Quest reward | "Tavern Regular" badge |
| `cosmetic` | Quest reward | Golden profile border |
| `premium` | Subscription/IAP | Premium membership |
| `boost` | IAP / Quest | Extra swipes, visibility boost |
| `bypass` | Subscription | Skip quest requirements |

### 2.5 — Integration with Quests

When entitlements is built, add to `quests_go`:

```go
// On quest completion, also grant entitlement:
callEntitlementsGrant(profileID, reward.EntitlementID, "quest:"+questID)
```

Bypass flow:
```
Frontend → GET /quests/profile/{id}
  quests_go → GET /entitlements/profile/{id}/bypass_quests
    → if premium: return all quests as "completed"
    → if not: return normal progress
```

### 2.6 — Services That Check Entitlements

| Service | Check | Example |
|---------|-------|---------|
| `discovery_go` | Swipe limits | "Does user have `extra_swipes`?" |
| `quests_go` | Quest bypass | "Does user have `bypass_quests`?" |
| `profiles_go` | Cosmetics | "Does user have `gold_border`?" |

---

## Open Decisions (Decide Before Building)

- [ ] **Quest assignment**: Auto-assign all active quests to every profile, or quest board where users browse/accept?
- [ ] **Frontend surface**: Dedicated quests tab? Section in profile screen? Bot-narrated in chat?
- [ ] **Daily/weekly resets**: Cron scheduler or time-window logic in trigger handler?
- [ ] **Quest completion events**: New `quest-events-v1` Pub/Sub topic so bots can react to completions?
- [ ] **Swipe event topic**: Add `{env}-discovery-swipe-events-v1` from discovery for swipe-count quests?
