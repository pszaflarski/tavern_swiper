# Quest Checkpoint System — Next Steps

> **Status**: Checkpoint infrastructure is deployed and backward compatible.
> Existing callers (bots_go, agent_router) continue to work unchanged.
> This document outlines the next phase: making bots checkpoint-aware.

---

## What's Done (This PR)

- ✅ `checkpoint_templates` top-level collection with `bot_id`, `description`, `sort_order`
- ✅ `checkpoint_status` collection tracking per-profile checkpoint completion
- ✅ `POST /quests/status/` auto-advances checkpoints behind the scenes
- ✅ Quest only completes when ALL ordered checkpoints are done
- ✅ Rewards stay at quest level, granted on quest completion
- ✅ Admin CRUD for checkpoint templates
- ✅ Checkpoint status query endpoints (by user_id and by profile_id)
- ✅ Seed data for both existing quests (1 checkpoint each)
- ✅ Fully backward compatible — zero changes to bots_go or agent_router

---

## Required: Firestore Indexes

Before deploying, these composite indexes must be created in `quests-{env}`:

### `checkpoint_templates` collection

| Fields | Order | Why |
|--------|-------|-----|
| `quest_id` ASC, `sort_order` ASC | Composite | Load checkpoints for a quest in order |
| `bot_id` ASC | Single-field | Bots query their own checkpoints |

### `checkpoint_status` collection

| Fields | Order | Why |
|--------|-------|-----|
| `quest_id` ASC, `user_id` ASC | Composite | Check which checkpoints a user has completed |

> **CRITICAL**: Firestore Enterprise Native has NO default indexes.
> Even single-field queries will fail without explicitly created indexes.
> Use `scripts/apply-indexes.sh` or `gcloud firestore indexes composite create`.

---

## Next Phase: Bot-Driven Checkpoint Completion

### The Vision

Instead of hard-coding quest completion logic in bots_go and agent_router,
bots will **dynamically discover and evaluate checkpoints** using LangGraph tools.

### New Tool: `check_and_complete_checkpoints`

Each bot (via agent_router) gets a tool that:

1. **Queries** `checkpoint_templates WHERE bot_id == {my_bot_id}`
   to find all checkpoints assigned to this bot
2. **Reads the description** to understand what needs to happen
   (e.g., "Send a message to Grogmar the bartender and receive a reply")
3. **Decides** based on the conversation context whether the condition is met
4. **If met** → calls `POST /quests/checkpoints/complete` (new endpoint, or
   continues using `POST /quests/status/` which handles it behind the scenes)
5. **If not met** → returns info about what's still needed (for narration)

### Example Flow: Grogmar and "OI YA GIT!"

```
User sends first message to Grogmar
  → agent_router invokes Grogmar agent
  → Grogmar's LLM calls check_and_complete_checkpoints tool
  → Tool queries: checkpoint_templates WHERE bot_id == "grogmar"
  → Finds: "send_message_to_grogmar" (desc: "...receive a reply...")
  → Tool checks: has this user's checkpoint been completed? No.
  → Tool checks: has the condition been met? Yes — the user just sent a message.
  → Tool completes the checkpoint → quest auto-completes → D6 granted
  → Tool returns: "Quest 'OI YA GIT!' completed! Reward: 1x D6 die"
  → LLM narrates tossing the cube at the adventurer
```

### Example Flow: Future Multi-Checkpoint Quest

```
Quest: "Grogmar's Wager" (3 checkpoints)
  1. send_message_to_grogmar — "Start a conversation with Grogmar"
  2. play_dice_with_grogmar  — "Play a game of dice with Grogmar"
  3. win_dice_against_grogmar — "Win a game of dice against Grogmar"

User messages Grogmar:
  → Tool finds checkpoint 1 is the next uncompleted one
  → Condition met (message sent) → completes checkpoint 1
  → Quest status: "started" (2 checkpoints remaining)

User plays dice with Grogmar:
  → Tool finds checkpoint 2 is next
  → Condition met (dice game happened) → completes checkpoint 2
  → Quest status: "started" (1 checkpoint remaining)

User wins the dice game:
  → Tool finds checkpoint 3 is next
  → LLM evaluates description: "Win a game of dice"
  → Did the user win? YES → completes checkpoint 3
  → All checkpoints done → quest auto-completes → rewards granted
  
User loses the dice game:
  → Tool finds checkpoint 3 is next
  → Did the user win? NO → checkpoint NOT completed
  → Tool returns: "Checkpoint not met — the adventurer needs to win"
  → LLM narrates Grogmar's gloating: "HAH! Better luck next time, runt!"
```

### What Needs to Be Built

1. **New LangGraph tool** in `agent_router/tools/`:
   - `check_and_complete_checkpoints(user_id, profile_id)` — zero visible args
   - Queries checkpoints by `bot_id` (injected from config)
   - Reads descriptions, evaluates conditions against conversation context
   - Completes checkpoints and returns plain English action strings

2. **New quests_go endpoint** (optional):
   - `POST /quests/checkpoints/complete` — explicit checkpoint completion
   - Takes `quest_id`, `checkpoint_id`, `profile_id`, `user_id`
   - Or just keep using `POST /quests/status/` which auto-advances

3. **New quests_go endpoint** for bot discovery:
   - `GET /quests/checkpoints/by-bot/{bot_id}` — list all checkpoints for a bot
   - Includes checkpoint status for a given user so the tool knows what's done

4. **Update bot system prompts** to use the new tool instead of the
   hard-coded quest tools

5. **Deprecate old quest tools**:
   - `complete_oi_ya_git_quest` in agent_router → replaced by generic tool
   - `tryCompleteQuest` in bots_go → replaced by checkpoint-aware flow

### Migration Path

| Step | What | Risk |
|------|------|------|
| 1 | Deploy checkpoint infrastructure (this PR) | None — backward compatible |
| 2 | Seed checkpoint data (`seed_objects.py`) | None — additive data |
| 3 | Create Firestore indexes | None — additive |
| 4 | Build `check_and_complete_checkpoints` tool | None — new code |
| 5 | Add `GET /quests/checkpoints/by-bot/:bot_id` endpoint | None — additive |
| 6 | Wire Grogmar to use new tool | Test in dev first |
| 7 | Remove old `complete_oi_ya_git_quest` tool | After validation |
| 8 | Wire bots_go tavern_keeper behavior to use checkpoints | Test in dev first |
| 9 | Remove old `tryCompleteQuest` from bots_go | After validation |

---

## Open Questions

- [ ] Should the tool query checkpoints on every message, or only on
      specific triggers? (Performance vs. flexibility)
- [ ] Should checkpoint descriptions be pure natural language, or include
      structured conditions the tool can evaluate programmatically?
- [ ] For complex conditions like "win a dice game" — does the LLM evaluate
      the conversation history, or does the tool check game state from metadata?
- [ ] Should there be checkpoint-level rewards in addition to quest-level rewards?
      (Currently all rewards are quest-level)
