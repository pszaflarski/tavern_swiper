# Quest Checkpoint System — Next Steps

> **Status**: Checkpoint infrastructure is deployed and backward compatible.
> Existing callers (bots_go, agent_router) continue to work unchanged.
> This document outlines the next phase: making bots checkpoint-aware.

---

## What's Done

- ✅ `checkpoint_templates` top-level collection with `bot_id`, `description`, `detailed_description`, `success_criteria`, `sort_order`
- ✅ `checkpoint_status` collection tracking per-profile checkpoint completion
- ✅ `POST /quests/status/` auto-advances checkpoints behind the scenes
- ✅ Quest only completes when ALL ordered checkpoints are done
- ✅ Rewards stay at quest level, granted on quest completion
- ✅ Admin CRUD for checkpoint templates
- ✅ Checkpoint status query endpoints (by user_id and by profile_id)
- ✅ Seed data for both existing quests (1 checkpoint each)
- ✅ Fully backward compatible — zero changes to bots_go or agent_router
- ✅ Three-field checkpoint design: `description` (short label), `detailed_description` (narrative), `success_criteria` (testable condition)

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

## Next Phase: Two-Tool Checkpoint System

### Core Insight: LLM Evaluates, Tools Fetch and Act

The LLM already has the full conversation history via LangGraph's checkpointer
(persisted `MessagesState` per `thread_id`). We don't need to inject
conversation context into tools — the LLM reads `success_criteria` from the
tool's response and evaluates it against the conversation it already sees.

This means tools should be **dumb data shuttles**, not evaluators:

### Tool 1: `get_my_checkpoints` (Read-Only)

Fetches all checkpoints assigned to this bot, merged with the user's
completion status. Returns structured info to the LLM.

| Property | Value |
|----------|-------|
| **Visible args** | None (bot_id + profile_id injected via `RunnableConfig`) |
| **API call** | `GET /quests/checkpoints/by-bot/{bot_id}?profile_id={profile_id}` |
| **Returns to LLM** | List of checkpoints with all fields + status |

**Example return value** (plain text, not JSON — for LLM consumption):

```
CHECKPOINT 1 of 1 for quest "oi_ya_git":
  checkpoint_id: send_message_to_grogmar
  status: NOT COMPLETED
  description: Talk to Grogmar the bartender
  success_criteria: The user has sent at least one message to Grogmar
    in this conversation AND Grogmar has generated a reply.
  detailed_description: Grogmar is a cantankerous orc barkeep who
    grudgingly acknowledges newcomers...
```

The LLM reads `success_criteria`, looks at the conversation history (which
LangGraph gives it for free), and decides whether the condition is met.

### Tool 2: `complete_checkpoint` (Write)

Marks a specific checkpoint as complete. Triggers quest auto-advancement
(next checkpoint becomes active, or quest completes if all done).

| Property | Value |
|----------|-------|
| **Visible args** | `checkpoint_id`, `quest_id` (LLM provides from get_my_checkpoints result) |
| **Hidden args** | `profile_id` injected via `RunnableConfig` |
| **API call** | `POST /quests/status/by-profile/` (existing endpoint, auto-advances) |
| **Returns to LLM** | Result string: checkpoint completed / quest completed + rewards / error |

**Example return values:**

```
# Checkpoint completed, more remain:
"Checkpoint 'send_message_to_grogmar' completed. Quest 'oi_ya_git' is now
 in progress (0 checkpoints remaining)."

# Last checkpoint → quest completes:
"Checkpoint 'send_message_to_grogmar' completed. Quest 'OI YA GIT!'
 COMPLETED! Rewards granted: 1x D6 die."

# Already done:
"Checkpoint already completed."
```

### Why Two Tools Instead of One

1. **Separation of concerns**: Read vs. write. The LLM decides, the tools execute.
2. **The LLM is the evaluator**: It already has the conversation history from
   LangGraph checkpoints. Natural language `success_criteria` is exactly what
   LLMs are good at evaluating. No need to duplicate that logic in Python.
3. **Hint behavior is free**: If the LLM calls `get_my_checkpoints` and decides
   the criteria isn't met, it just... doesn't call `complete_checkpoint`. Instead
   it uses `description` and `detailed_description` to give the user a hint,
   naturally in character.
4. **Testable without an LLM**: A deterministic test agent can call
   `get_my_checkpoints`, inspect the response, and conditionally call
   `complete_checkpoint` — no LLM needed.

---

## Example Flows

### Flow 1: Grogmar — Single Checkpoint Quest (Happy Path)

```
User sends first message to Grogmar
  → LangGraph loads full thread from checkpointer (all prior messages)
  → LLM sees entire conversation history
  → LLM calls get_my_checkpoints tool
  → Tool calls GET /quests/checkpoints/by-bot/grogmar?profile_id=xxx
  → Tool returns:
      "CHECKPOINT 1 of 1 for quest 'oi_ya_git':
       checkpoint_id: send_message_to_grogmar
       status: NOT COMPLETED
       success_criteria: The user has sent at least one message...
       detailed_description: Grogmar is a cantankerous orc barkeep..."
  → LLM reads success_criteria + looks at conversation history
  → LLM decides: user sent a message, I'm about to reply → criteria met
  → LLM calls complete_checkpoint(checkpoint_id="send_message_to_grogmar",
                                   quest_id="oi_ya_git")
  → Tool returns: "Quest 'OI YA GIT!' COMPLETED! Rewards: 1x D6 die."
  → LLM uses detailed_description to narrate tossing the die at the adventurer
```

### Flow 2: Multi-Checkpoint Quest (Progression)

```
Quest: "Grogmar's Wager" (3 checkpoints)
  1. start_conversation  — "Start a conversation with Grogmar"
  2. play_dice           — "Play a game of dice with Grogmar"
  3. win_dice            — "Win a game of dice against Grogmar"

Turn 1 — User messages Grogmar:
  → LLM calls get_my_checkpoints
  → Gets checkpoint 1: status NOT COMPLETED, criteria: "Start a conversation"
  → LLM evaluates: user sent a message → criteria met
  → LLM calls complete_checkpoint("start_conversation", "grogmars_wager")
  → Returns: "Checkpoint completed. 2 remaining."

Turn 5 — User plays dice:
  → LLM calls get_my_checkpoints
  → Gets checkpoint 2: status NOT COMPLETED, criteria: "Play a game of dice"
  → LLM evaluates: dice game happened in conversation → criteria met
  → LLM calls complete_checkpoint("play_dice", "grogmars_wager")
  → Returns: "Checkpoint completed. 1 remaining."

Turn 6 — User loses the dice game:
  → LLM calls get_my_checkpoints
  → Gets checkpoint 3: status NOT COMPLETED, criteria: "Win a game of dice"
  → LLM evaluates: user lost → criteria NOT met
  → LLM does NOT call complete_checkpoint
  → LLM uses description ("Win a game of dice") to hint:
    "HAH! BETTER LUCK NEXT TIME, RUNT! DA DICE DON'T LIE!"

Turn 8 — User wins the dice game:
  → LLM calls get_my_checkpoints
  → Gets checkpoint 3: status NOT COMPLETED, criteria: "Win a game of dice"
  → LLM evaluates: user won → criteria met
  → LLM calls complete_checkpoint("win_dice", "grogmars_wager")
  → Returns: "Quest 'Grogmar's Wager' COMPLETED! Rewards: 500 gold."
```

### Flow 3: Already Completed (Returning User)

```
User messages Grogmar again (quest already done):
  → LLM calls get_my_checkpoints
  → Tool returns: "All checkpoints completed for quest 'oi_ya_git'."
  → LLM responds normally — no quest actions, no hints
```

---

## What Needs to Be Built

### 1. `GET /quests/checkpoints/by-bot/{bot_id}` endpoint (quests_go)

New endpoint that merges checkpoint templates with status for a given profile.

```
GET /quests/checkpoints/by-bot/grogmar?profile_id=xxx

Response:
[
  {
    "quest_id": "oi_ya_git",
    "quest_title": "OI YA GIT!",
    "checkpoint_id": "send_message_to_grogmar",
    "description": "Talk to Grogmar the bartender",
    "detailed_description": "Grogmar is a cantankerous orc barkeep...",
    "success_criteria": "The user has sent at least one message...",
    "sort_order": 1,
    "status": "not_completed",
    "quest_status": "not_started",
    "quest_rewards": [{"item_id": "dice_d6", "quantity": 1}]
  }
]
```

Key design decisions:
- Resolves `profile_id → user_id` internally (like existing by-profile endpoints)
- Joins checkpoint templates with checkpoint_status to include completion state
- Includes quest-level info (title, rewards, quest status) so the tool has everything
- Filters out quests that are already fully completed (or includes with status = "completed")
- Bot and admin only (requires auth)

### 2. `get_my_checkpoints` tool (agent_router/tools/)

```python
@tool
def get_my_checkpoints(config: RunnableConfig) -> str:
    """Check what quest checkpoints are assigned to you and their current status.

    Call this at the start of every reply to see if there are quest
    objectives you need to evaluate.
    """
    # bot_id + profile_id from config (injected by agent_router)
    # GET /quests/checkpoints/by-bot/{bot_id}?profile_id={profile_id}
    # Format response as plain text for LLM consumption
```

### 3. `complete_checkpoint` tool (agent_router/tools/)

```python
@tool
def complete_checkpoint(checkpoint_id: str, quest_id: str,
                        config: RunnableConfig) -> str:
    """Mark a quest checkpoint as complete.

    Call this ONLY after you have evaluated the success_criteria from
    get_my_checkpoints and determined it has been met based on the
    conversation history.
    """
    # profile_id from config
    # POST /quests/status/by-profile/ with quest_id + profile_id + status="completed"
    # Return result string
```

### 4. Update bot system prompts

Replace the current `QUEST TOOL` section in Grogmar's prompt with:

```
QUEST CHECKPOINTS:
- At the START of every reply, call get_my_checkpoints to check for active objectives.
- Read the success_criteria for each uncompleted checkpoint.
- Look at the conversation history to decide if the criteria is met.
- If met: call complete_checkpoint with the checkpoint_id and quest_id.
  Then narrate the reward naturally using the detailed_description.
- If NOT met: give the adventurer a hint using the description, staying in character.
  Do NOT reveal the exact success_criteria — keep it natural.
- If all checkpoints are completed: respond normally, no quest actions needed.
- NEVER mention quests, checkpoints, tools, or game mechanics out loud.
```

### 5. Deprecate old quest tools

- Remove `check_quest_status` tool and `QUEST_ACTIONS` dict from `tools/quest_status.py`
- Remove `tryCompleteQuest` from `bots_go/behaviors.go`
- Both replaced by the generic checkpoint tools

---

## Integration Test Plan

### Goal

Verify the full checkpoint → quest completion pipeline works end-to-end
using a **deterministic fake agent** (no LLM). The agent follows a simple
decision tree that mirrors what a real LLM would do.

### Test Agent: `checkpoint_test_agent`

A LangGraph agent wired with `get_my_checkpoints` and `complete_checkpoint`
tools, using a deterministic decision function instead of an LLM:

```python
# Pseudo-logic for the deterministic agent:
def decide(checkpoints_response, conversation_messages):
    for checkpoint in parse(checkpoints_response):
        if checkpoint.status == "completed":
            continue
        if evaluate_criteria(checkpoint.success_criteria, conversation_messages):
            return call_complete_checkpoint(checkpoint.checkpoint_id, checkpoint.quest_id)
        else:
            return f"hint:{checkpoint.description}"
    return "no_action"
```

The `evaluate_criteria` function is a simple keyword matcher for tests:
- `"sent at least one message"` → check if there's a HumanMessage in history
- `"won a game of dice"` → check if "you win" appears in an AIMessage
- Etc. — no LLM needed, just string matching for test scenarios

### Test Setup

Each test creates:
1. A **fake quest** with N checkpoint templates (mocked API responses)
2. A **fake profile_id** and checkpoint statuses (mocked API responses)
3. The deterministic agent compiled with an in-memory checkpointer

### Test Cases

#### Test 1: Single checkpoint — criteria met → quest completes

```
Setup:
  Quest "test_quest" with 1 checkpoint: "say_hello"
  success_criteria: "The user has sent at least one message"
  Checkpoint status: not_completed

Input: HumanMessage("Hello!")

Expected:
  1. Agent calls get_my_checkpoints → gets 1 uncompleted checkpoint
  2. Evaluates criteria: user sent a message → YES
  3. Agent calls complete_checkpoint("say_hello", "test_quest")
  4. Response includes completion confirmation
```

#### Test 2: Multi-checkpoint — advances one at a time

```
Setup:
  Quest "test_quest" with 3 checkpoints:
    cp1: "start_chat"    — criteria: "sent a message"        — not_completed
    cp2: "play_dice"     — criteria: "played dice"           — not_completed
    cp3: "win_dice"      — criteria: "won the dice game"     — not_completed

Turn 1 — HumanMessage("Hello!"):
  → Agent completes cp1 only (criteria met: message sent)
  → cp2 and cp3 remain uncompleted

Turn 2 — HumanMessage("Let's play dice"):
  → Mock: cp1 now completed, cp2 still not_completed
  → Agent completes cp2 (criteria met: "played dice" in message)
  → cp3 remains

Turn 3 — AIMessage in history contains "you win":
  → Mock: cp1 + cp2 completed, cp3 not_completed
  → Agent completes cp3 → quest completes → rewards granted
```

#### Test 3: Criteria not met → hint returned

```
Setup:
  Quest "test_quest" with 1 checkpoint: "win_dice"
  success_criteria: "The user won the dice game"
  description: "Win a game of dice"
  Checkpoint status: not_completed

Input: HumanMessage("I lost the dice game")

Expected:
  1. Agent calls get_my_checkpoints → gets 1 uncompleted checkpoint
  2. Evaluates criteria: "won the dice game" — NO match in conversation
  3. Agent does NOT call complete_checkpoint
  4. Agent returns: "hint:Win a game of dice"
```

#### Test 4: All checkpoints already completed → no action

```
Setup:
  Quest "test_quest" with 1 checkpoint: "say_hello"
  Checkpoint status: completed

Input: HumanMessage("Hello again!")

Expected:
  1. Agent calls get_my_checkpoints → all checkpoints completed
  2. Agent returns: "no_action"
  3. complete_checkpoint is NOT called
```

#### Test 5: Multiple quests for the same bot

```
Setup:
  Quest A: 1 checkpoint, not_completed, criteria met
  Quest B: 1 checkpoint, not_completed, criteria NOT met

Expected:
  → Quest A checkpoint completed
  → Quest B returns hint
```

### Test File Location

`services/agent_router/tests/test_checkpoint_tools.py`

Uses the same patterns as `test_grogmar_quest_tools.py`:
- `@patch` for mocked HTTP calls to the quests service
- `_FakeToolChatModel` for LangGraph compilation (tools are what we're testing)
- `conftest.py` checkpointer fixture for persistence
- `pytest.mark.base` for CI inclusion

### Mock Strategy

The tests mock **HTTP calls to the quests service**, not the tools themselves.
This means the full tool logic (formatting, error handling, response parsing)
is exercised:

```python
@patch("tools.checkpoints._fetch_bot_checkpoints")
@patch("tools.checkpoints._complete_quest_checkpoint")
def test_single_checkpoint_completion(mock_complete, mock_fetch):
    mock_fetch.return_value = [
        {
            "quest_id": "test_quest",
            "checkpoint_id": "say_hello",
            "status": "not_completed",
            "success_criteria": "The user has sent at least one message",
            "description": "Say hello",
            "detailed_description": "...",
        }
    ]
    mock_complete.return_value = {"status": "completed", "quest_completed": True}

    # Run deterministic agent with HumanMessage("Hello!")
    # Assert complete_checkpoint was called with correct args
    # Assert response indicates quest completion
```

---

## Migration Path

| Step | What | Risk |
|------|------|------|
| 1 | Deploy checkpoint infrastructure ✅ | None — done |
| 2 | Seed checkpoint data ✅ | None — done |
| 3 | Create Firestore indexes | None — additive |
| 4 | Add `GET /quests/checkpoints/by-bot/:bot_id` endpoint | None — additive |
| 5 | Build `get_my_checkpoints` + `complete_checkpoint` tools | None — new code |
| 6 | Write deterministic integration tests | None — test code |
| 7 | Wire Grogmar to use new tools | Test in dev first |
| 8 | Remove old `check_quest_status` tool + `QUEST_ACTIONS` | After validation |
| 9 | Wire bots_go tavern_keeper behavior to use checkpoints | Test in dev first |
| 10 | Remove old `tryCompleteQuest` from bots_go | After validation |

---

## Resolved Design Decisions

- [x] **Who evaluates success_criteria?** The LLM — it already has the full
      conversation history via LangGraph's checkpointer. Tools are dumb data
      shuttles, not evaluators.
- [x] **How does the tool access conversation context?** It doesn't need to.
      LangGraph persists `MessagesState` per `thread_id` via the checkpointer.
      The LLM sees all prior messages automatically.
- [x] **One tool or two?** Two: `get_my_checkpoints` (read) and
      `complete_checkpoint` (write). Clean separation of concerns.
- [x] **Checkpoint descriptions — natural language or structured?**
      Natural language. Three fields: `description` (UI label),
      `detailed_description` (narrative), `success_criteria` (testable condition).
- [x] **Tool queries on every message?** Yes — `get_my_checkpoints` is called
      at the start of every reply (same pattern as current `check_quest_status`).
      The endpoint is lightweight (single Firestore query by bot_id).

## Open Questions

None — all resolved. See "Resolved Design Decisions" above.

### Future Considerations (Not Blocking)

- **Checkpoint-level rewards**: Not now — all rewards stay at quest level.
  If added later, this lives in the quests service (checkpoint template gains
  a `rewards` field, granted on individual checkpoint completion).
- **Advanced game mechanics**: For now, `success_criteria` is evaluated
  naturally by the LLM from conversation context. For more complex mechanics
  (dice rolls, combat systems), we may add structured conditions to the
  checkpoint's `metadata` field that the tool can evaluate programmatically
  before passing results to the LLM.
