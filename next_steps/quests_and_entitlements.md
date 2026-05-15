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
| `quest_templates` | Auto-generated | Quest definitions with branching step graph |
| `item_definitions` | `{item_id}` | The item catalog — name, description, image, rarity, max_stack |
| `user_inventory` | `inv_{user_id}_{item_id}` | What each user owns — item_id, quantity |
| `user_quests` | `quest_{quest_id}_{user_id}` | Per-user quest progress — current step, trigger counts |
| `quest_events` | Auto-generated | Idempotency / audit log |
| `inventory_ledger` | Auto-generated | Append-only audit log of all item grants/deductions |

> **User-level, not profile-level**: Inventory and quest progress are keyed by `user_id` so all of a user's profiles share the same inventory and quest state. Profile-level events (message_sent, match_made) already include `user_id` in the event context, so the mapping is free.

### 1.3 — Item Definition Model

Everything is stackable. A unique weapon has `quantity: 1`, gold has `quantity: 500`. The `max_stack` field on the definition controls limits (0 = unlimited).

```go
type ItemDefinition struct {
    ItemID      string         `firestore:"item_id"`
    Name        string         `firestore:"name"`        // "Staff of Whispers"
    Description string         `firestore:"description"` // Flavor text
    ImageURL    string         `firestore:"image_url"`
    Category    string         `firestore:"category"`    // currency, weapon, armor, consumable, cosmetic, key_item, badge
    Rarity      string         `firestore:"rarity"`      // common, uncommon, rare, epic, legendary
    MaxStack    int            `firestore:"max_stack"`   // 0 = unlimited, 1 = unique
    Tradeable   bool           `firestore:"tradeable"`
    Metadata    map[string]any `firestore:"metadata"`    // flexible extra data
    CreatedAt   time.Time      `firestore:"created_at"`
    UpdatedAt   time.Time      `firestore:"updated_at"`
}
```

### 1.4 — User Inventory Model

```go
type UserInventoryEntry struct {
    UserID    string    `firestore:"user_id"`
    ItemID    string    `firestore:"item_id"`
    Quantity  int       `firestore:"quantity"`
    AcquiredAt time.Time `firestore:"acquired_at"` // first acquisition
    UpdatedAt  time.Time `firestore:"updated_at"` // last quantity change
}
```

Grant/deduct is a single function — increment quantity, create doc if missing, reject if `max_stack` exceeded.

### 1.5 — Quest Template Model (Branching Step Graph)

Quests are modeled as a **directed graph of steps**. Each step can have triggers (events the user must complete), rewards (items granted on step completion), and branching (player choices or conditional routing).

```go
type QuestTemplate struct {
    QuestID     string              `firestore:"quest_id"`
    Title       string              `firestore:"title"`
    Description string              `firestore:"description"`
    QuestType   string              `firestore:"quest_type"`  // daily, weekly, story, achievement
    Status      string              `firestore:"status"`      // draft, active, retired
    SortOrder   int                 `firestore:"sort_order"`
    StartStep   string              `firestore:"start_step"` // ID of the first step
    Steps       map[string]QuestStep `firestore:"steps"`      // step_id -> step definition
    CreatedAt   time.Time           `firestore:"created_at"`
    UpdatedAt   time.Time           `firestore:"updated_at"`
}

type QuestStep struct {
    Narrative string          `firestore:"narrative"`           // Story text shown to the player
    Triggers  []QuestTrigger  `firestore:"triggers,omitempty"` // Events required to complete this step
    Rewards   []ItemReward    `firestore:"rewards,omitempty"`  // Items granted on step completion
    Next      []string        `firestore:"next,omitempty"`     // Next step(s) — single = linear, omit = final step
    Branches  []QuestBranch   `firestore:"branches,omitempty"` // Player choices (mutually exclusive with Next)
}

type QuestTrigger struct {
    EventType     string         `firestore:"event_type"`     // profile_created, match_made, message_sent, dice_rolled
    RequiredCount int            `firestore:"required_count"`
    Filters       map[string]any `firestore:"filters"`        // e.g. {"dice_type": "d20"}
}

type QuestBranch struct {
    Label string `firestore:"label"` // "Investigate", "Ignore"
    Next  string `firestore:"next"`  // step_id to advance to
}

type ItemReward struct {
    ItemID   string `firestore:"item_id"`
    Quantity int    `firestore:"quantity"`
}
```

**Step types by field combination:**
- **Trigger step**: Has `triggers` + `next` → auto-advances when triggers are satisfied
- **Choice step**: Has `branches` → player picks, frontend calls choose endpoint
- **Trigger + choice**: Has `triggers` + `branches` → complete trigger first, then choose
- **Final step**: No `next` or `branches` → quest complete

### 1.6 — Quest Progress Model (User-Level)

```go
type UserQuest struct {
    UserID        string                    `firestore:"user_id"`
    QuestID       string                    `firestore:"quest_id"`
    CurrentStep   string                    `firestore:"current_step"`    // which step the user is on
    StepProgress  map[string]map[string]int `firestore:"step_progress"`   // step_id -> {event_type -> count}
    Status        string                    `firestore:"status"`          // active, completed, abandoned
    StartedAt     time.Time                 `firestore:"started_at"`
    CompletedAt   *time.Time                `firestore:"completed_at,omitempty"`
}
```

### 1.7 — Example: Branching Quest

```json
{
  "quest_id": "the_missing_heirloom",
  "title": "The Missing Heirloom",
  "quest_type": "story",
  "start_step": "start",
  "steps": {
    "start": {
      "narrative": "A hooded stranger slides a note across the bar...",
      "triggers": [{ "event_type": "message_sent", "required_count": 1 }],
      "rewards": [{ "item_id": "gold", "quantity": 10 }],
      "next": ["investigate_or_ignore"]
    },
    "investigate_or_ignore": {
      "narrative": "The note reads: 'Meet me in the cellar.' Do you go?",
      "branches": [
        { "label": "Investigate the cellar", "next": "cellar_encounter" },
        { "label": "Stay at the bar", "next": "tavern_gossip" }
      ]
    },
    "cellar_encounter": {
      "narrative": "You find a locked chest guarded by a riddle...",
      "triggers": [{ "event_type": "dice_rolled", "required_count": 1, "filters": { "dice_type": "d20" } }],
      "rewards": [{ "item_id": "staff_of_whispers", "quantity": 1 }],
      "next": ["complete"]
    },
    "tavern_gossip": {
      "narrative": "You overhear a rumor about the heirloom's true owner...",
      "triggers": [{ "event_type": "match_made", "required_count": 1 }],
      "rewards": [{ "item_id": "gold", "quantity": 50 }],
      "next": ["complete"]
    },
    "complete": {
      "narrative": "The mystery unfolds, one way or another.",
      "rewards": [{ "item_id": "badge_investigator", "quantity": 1 }]
    }
  }
}
```

### 1.8 — API Endpoints (quests_go)

**Admin — Quest Templates:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/quests/templates/` | Create quest template |
| `GET` | `/quests/templates/` | List all templates |
| `GET` | `/quests/templates/{id}` | Get template |
| `PUT` | `/quests/templates/{id}` | Update template |
| `DELETE` | `/quests/templates/{id}` | Retire template |

**Admin — Item Definitions:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/quests/items/` | Create item definition |
| `GET` | `/quests/items/` | List all items in catalog |
| `GET` | `/quests/items/{item_id}` | Get item definition |
| `PUT` | `/quests/items/{item_id}` | Update item definition |
| `DELETE` | `/quests/items/{item_id}` | Remove item from catalog |
| `POST` | `/quests/inventory/grant` | Admin-grant items to a user |
| `POST` | `/quests/inventory/deduct` | Admin-deduct items from a user |

**Player — Quests:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/quests/user/{user_id}` | List quests + progress for user |
| `GET` | `/quests/user/{user_id}/available` | Quests not yet started |
| `POST` | `/quests/user/{user_id}/accept/{quest_id}` | Accept a quest |
| `POST` | `/quests/user/{user_id}/quest/{quest_id}/choose` | Choose a branch at a choice step |
| `POST` | `/quests/user/{user_id}/quest/{quest_id}/claim` | Claim rewards for a completed quest |

**Player — Inventory:**
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/quests/inventory/user/{user_id}` | List all items in user's inventory |
| `GET` | `/quests/inventory/user/{user_id}/{item_id}` | Check quantity of a specific item |

**Internal:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/quests/internal/trigger` | Process event trigger (from subscriber) |

### 1.9 — Pub/Sub Subscriptions (quests_subscriber)

Subscribe to existing topics — no changes to other services needed:

| Topic | Trigger Name |
|-------|-------------|
| `{env}-profiles-profile-events-v1` | `profile_created` |
| `{env}-discovery-match-events-v1` | `match_made` |
| `{env}-messages-message-events-v1` | `message_sent` |

Copy proto definitions from existing subscribers. Use subscription name to disambiguate event types (same pattern as `bots_subscriber`).

### 1.10 — Trigger Processing Flow

1. `quests_subscriber` receives Pub/Sub event
2. Deserializes protobuf, maps to trigger name + context (including `user_id`)
3. Calls `POST /quests/internal/trigger` on `quests_go`
4. `quests_go` finds all active `user_quests` for that user
5. For each quest, checks if the current step has a trigger matching this event
6. Increments `step_progress[current_step][event_type]`
7. If all triggers on the step are satisfied:
   - Grant step rewards (write to `user_inventory`)
   - If step has a single `next` → advance `current_step`
   - If step has `branches` → wait for player choice
   - If step is final → mark quest completed

### 1.11 — Cloud Build & Deploy

- Add `cloudbuild.yaml` for both containers
- Create GCP Pub/Sub subscriptions pointing to `quests_subscriber` Cloud Run URL
- Register services in the router

### 1.12 — Frontend (Quest & Inventory UI)

- Add quest log screen (or section in profile)
- Add inventory/bag screen showing owned items with quantities
- React Query hooks: `useGetQuests`, `useGetInventory`, `useClaimReward`, `useChooseBranch`
- Display quest step graph, narrative text, branch choices, reward previews
- Item cards with rarity-colored borders and category icons

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

- [ ] **Quest assignment**: Auto-assign all active quests to every user, or quest board where users browse/accept?
- [ ] **Frontend surface**: Dedicated quests tab? Inventory tab? Section in profile screen? Bot-narrated in chat?
- [ ] **Daily/weekly resets**: Cron scheduler or time-window logic in trigger handler?
- [ ] **Quest completion events**: New `quest-events-v1` Pub/Sub topic so bots can react to completions?
- [ ] **Swipe event topic**: Add `{env}-discovery-swipe-events-v1` from discovery for swipe-count quests?
- [ ] **Branch resolution model**: Player choice only? Trigger-driven (first matching event picks the branch)? Or support both?
- [ ] **Item trading**: Can users trade items with each other? If so, need a `trades` collection and trade confirmation flow.
- [ ] **Item consumption**: Can users "use" consumable items (e.g., potions, scrolls)? If so, what effects do they have and which services need to know?
- [ ] **Inventory limits**: Should there be an overall inventory size cap, or is `max_stack` per-item sufficient?
