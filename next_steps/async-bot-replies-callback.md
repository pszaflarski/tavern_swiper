# Async Bot Replies — Option A: Callback Pattern

> **Status**: Recommendation — not yet approved for implementation
> **Context**: Currently `bots_go` blocks for up to 60s waiting on `callAgentRouter()` while the LLM generates a reply. This ties up a Cloud Run instance doing nothing but waiting on an HTTP response. The callback pattern decouples this by having `agent_router` call back to `bots_go` when it's done.

## Overview

```
CURRENT (synchronous):
  bots_subscriber → bots_go → callAgentRouter() ──[blocks 30-60s]──→ response
                             → parseAgentResponse() → postBotMessage()
                             → tryCompleteQuest() (goroutine)

PROPOSED (callback):
  bots_subscriber → bots_go → POST /invoke-async (with callback_url) → 202 Accepted (instant)
                                                                        ↓
                                                              agent_router processes LLM
                                                                        ↓
                                                              POST callback_url with result
                                                                        ↓
                             bots_go /bots/agent-callback ← receives AI response
                             → parseAgentResponse() → postBotMessage()
                             → tryCompleteQuest() (goroutine)
```

**Key principle**: The agent_router learns one generic concept — "POST the result to a URL when done." All Tavern-specific domain logic (message/narration parsing, message posting, quest completion) stays in `bots_go`.

## Why This Option

- **agent_router stays generic**: The callback concept is a standard webhook pattern. No Tavern-specific knowledge bleeds into the AI routing layer. The `agent_router` submodule remains portable.
- **Domain logic stays in bots_go**: Message vs. narration parsing, posting to the messages service, milestone quest completion — all of this stays exactly where it is today, just triggered by an inbound webhook instead of a synchronous return value.
- **Deterministic delivery**: The reply always gets posted. There's no LLM decision point in the delivery path — the LLM generates content, the callback receives it, and `bots_go` posts it. No risk of the LLM "forgetting" to call a tool.
- **Clean refactor boundary**: `behaviorBotReply` in `behaviors.go` splits at the `callAgentRouter()` return point into "before" (identify bot, build metadata, fire async request) and "after" (parse response, post messages, complete quests).

## Proposed Changes

### agent_router (Python/FastAPI)

#### [MODIFY] [main.py](file:///home/peter/Documents/tavern_swiper/services/agent_router/main.py)

Add a `POST /invoke-async` endpoint alongside the existing `/invoke`:

- Accepts the same `InvokeRequest` fields plus:
  - `callback_url: str` — where to POST the result
  - `callback_headers: dict[str, str] | None` — headers to include (for auth)
  - `callback_metadata: dict | None` — opaque metadata to echo back in the callback (so `bots_go` can identify which conversation/bot this is for)
- Returns `202 Accepted` immediately with `{ "status": "accepted", "request_id": "<uuid>" }`
- Spawns a background task (`asyncio.create_task` or `BackgroundTasks`) that:
  1. Runs the same graph invocation logic as `/invoke`
  2. Extracts the last AI message
  3. POSTs the result to `callback_url` with `callback_headers`:
     ```json
     {
       "request_id": "<uuid>",
       "status": "success",
       "response": "<AI response text>",
       "thread_id": "<thread_id>",
       "agent": "<agent_name>",
       "model": "<model_name>",
       "callback_metadata": { ...echoed back... }
     }
     ```
  4. On failure (LLM error, timeout, rate limit), POSTs an error payload instead:
     ```json
     {
       "request_id": "<uuid>",
       "status": "error",
       "error": "rate_limited" | "agent_error" | "timeout",
       "detail": "...",
       "callback_metadata": { ...echoed back... }
     }
     ```

**Design note**: The `/invoke` (sync) endpoint remains unchanged for the demo UI and direct API usage. `/invoke-async` is additive.

---

### bots_go (Go/Gin)

#### [MODIFY] [behaviors.go](file:///home/peter/Documents/tavern_swiper/services/bots/bots_go/behaviors.go)

Split `behaviorBotReply` into two halves:

**Before (fire-and-forget)**: The existing code up to and including `callAgentRouter()` becomes `callAgentRouterAsync()`:
- Instead of calling `/invoke` and blocking, calls `/invoke-async` with:
  - `callback_url`: `<BOTS_SERVICE_URL>/bots/agent-callback` (self-referencing, resolved from router or env var)
  - `callback_headers`: `{"Authorization": "Bearer <bot_jwt>"}`
  - `callback_metadata`: All context needed to resume processing:
    ```json
    {
      "conversation_id": "...",
      "bot_profile_id": "...",
      "bot_user_id": "...",
      "sender_profile_id": "...",
      "behavior_type": "tavern_keeper",
      "agent_name": "grogmar"
    }
    ```
- Returns immediately after getting `202`. The behavior trigger handler responds with `200 OK`.

**After (callback handler)**: New handler `handleAgentCallback`:
- Receives the agent_router's callback POST
- Extracts `callback_metadata` to recover the conversation context
- Re-authenticates the bot user (or uses a cached/fresh token — the one from the request may have expired by the time the callback arrives)
- Runs the existing post-response logic:
  - `parseAgentResponse(response)`
  - `postBotMessage()` / `postBotNarration()` for each item
  - `tryCompleteQuest()` for milestone quests
- Returns `200 OK` to the agent_router

#### [MODIFY] [main.go](file:///home/peter/Documents/tavern_swiper/services/bots/bots_go/main.go)

Register the new callback endpoint:
```go
authorized.POST("/bots/agent-callback", handleAgentCallback)
```

#### [MODIFY] [models.go](file:///home/peter/Documents/tavern_swiper/services/bots/bots_go/models.go)

Add request/response structs for the callback:
```go
type AgentCallbackRequest struct {
    RequestID        string                 `json:"request_id"`
    Status           string                 `json:"status"` // "success" or "error"
    Response         string                 `json:"response,omitempty"`
    Error            string                 `json:"error,omitempty"`
    Detail           string                 `json:"detail,omitempty"`
    ThreadID         string                 `json:"thread_id,omitempty"`
    Agent            string                 `json:"agent,omitempty"`
    Model            string                 `json:"model,omitempty"`
    CallbackMetadata map[string]interface{} `json:"callback_metadata"`
}
```

---

### bots_subscriber

No changes needed. The subscriber already fires and forgets to `bots_go`.

## Edge Cases & Failure Modes

| Scenario | Handling |
|----------|----------|
| **agent_router crashes mid-processing** | Callback never arrives. The user gets no reply. Consider a dead-letter check: if no callback within N minutes, log a warning. This is equivalent to today's behavior when the 60s timeout fires. |
| **Callback URL unreachable** | agent_router should retry 1-2 times with backoff, then log the failure. Alternatively, push failed callbacks to a dead-letter Pub/Sub topic. |
| **Bot JWT expired by callback time** | The callback handler must re-authenticate the bot user (call `authenticateBotUser` again) rather than reusing the JWT from the original request. The JWT passed in `callback_headers` is for agent_router to auth the callback itself. |
| **Duplicate callbacks** | Use `request_id` as an idempotency key. Store it in `bot_events` and skip if already processed. |
| **agent_router cold start** | The `/invoke-async` endpoint still needs a warm instance to accept the request. But since it returns 202 immediately, the cold start only affects acceptance latency (~2-5s), not the 30-60s blocking window. |

## Auth Design for the Callback

The callback needs mutual authentication:

1. **bots_go → agent_router**: The `/invoke-async` request carries the bot's JWT (existing pattern).
2. **agent_router → bots_go callback**: The callback POST carries the same JWT back in the `callback_headers`. bots_go's auth middleware validates it. Since the callback may arrive minutes later, the JWT TTL should be extended for async requests, or bots_go should accept an internal service token for callbacks.

**Recommended**: Use a short-lived internal JWT minted by bots_go specifically for the callback, with a 5-minute TTL. Pass it in `callback_headers`. This avoids coupling callback auth to bot user credentials.

## Migration Path

1. **Phase 1**: Add `/invoke-async` to agent_router. Keep `/invoke` unchanged. Test async endpoint with manual curl/Swagger calls.
2. **Phase 2**: Add `handleAgentCallback` to bots_go. Wire up `callAgentRouterAsync()` but keep `callAgentRouter()` as a fallback behind a feature flag (env var `USE_ASYNC_AGENT=true`).
3. **Phase 3**: Once validated in dev, flip the flag and remove the sync path.

## Open Questions

1. **Retry policy**: Should agent_router retry the callback, or should bots_go poll for missed callbacks? Retries are simpler but risk duplicate messages if bots_go is slow to respond.
2. **Timeout alerting**: Should there be a monitoring check for "callback expected but never received"? Could be a simple Cloud Scheduler job that scans `bot_events` for stuck "processing" events.
3. **Self-referencing URL**: bots_go needs to know its own external URL for `callback_url`. In Cloud Run this is available via `K_SERVICE` + project config, or can be hardcoded per environment. Alternatively, the router service already knows the bots URL — bots_go can use `serviceURLs.Get("bots")`.
