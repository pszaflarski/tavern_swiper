# Async Bot Replies — Option B: Agent Send-Message Tool

> **Status**: Recommendation — not yet approved for implementation
> **Context**: Currently `bots_go` blocks for up to 60s waiting on `callAgentRouter()` while the LLM generates a reply. This option makes the LLM itself responsible for delivering its reply by giving it a `send_message` tool that posts back to `bots_go`.

## Overview

```
CURRENT (synchronous):
  bots_subscriber → bots_go → callAgentRouter() ──[blocks 30-60s]──→ response
                             → parseAgentResponse() → postBotMessage()
                             → tryCompleteQuest() (goroutine)

PROPOSED (agent tool):
  bots_subscriber → bots_go → POST /invoke-async (fire-and-forget) → 202 Accepted (instant)
                                                                       ↓
                                                             agent_router processes LLM
                                                                       ↓
                                                             LLM calls send_message tool
                                                                       ↓
                                                             tool POSTs to bots_go endpoint
                                                                       ↓
                             bots_go /bots/agent-delivery ← receives message + metadata
                             → postBotMessage() / postBotNarration()
                             → tryCompleteQuest() (goroutine)
```

**Key principle**: The LLM uses a tool to deliver its reply, making the agent truly autonomous. The tool itself is a thin HTTP client that calls a `bots_go` endpoint — all domain logic (posting to messages service, quest handling) remains in `bots_go`.

## Why This Option

- **Truly agentic**: The agent decides when and what to send. This is the natural evolution if you want agents that can initiate conversations, send follow-ups, or delay responses.
- **Streaming-friendly**: The LLM could call `send_message` multiple times — e.g., send a narration first, then a dialogue message — without needing bots_go to parse a structured JSON array. Each tool call is one delivery.
- **Future-proof for proactive agents**: Once agents have a `send_message` tool, adding "Grogmar checks in after 24h of silence" is trivial — it's just another invocation with the same tool.
- **Eliminates structured response parsing**: Today, `bots_go` parses a JSON array of `[{"type": "message", "content": "..."}, {"type": "narration", "content": "..."}]` from the raw AI response (with fallback for plain text, markdown fence stripping, etc.). With a tool, each `send_message` call is typed — no parsing ambiguity.

## Why This Option Has More Risk

- **LLM reliability**: If the LLM forgets to call `send_message`, the user gets silence. Today, delivery is deterministic — if the AI returns *anything*, bots_go posts it. With a tool, delivery depends on the LLM following instructions.
- **Prompt complexity**: Every agent's system prompt must instruct the LLM to call `send_message` for every response item. This adds prompt engineering overhead and a new failure mode per agent.
- **Multiple tool calls**: If the LLM wants to send a narration + a message + another narration (3 items), it needs to make 3 tool calls. Some LLMs handle parallel tool calls well, others serialize them — which means 3 sequential HTTP round-trips from agent_router to bots_go.
- **Ordering**: Multiple `send_message` calls might arrive at bots_go out of order, especially under load or with parallel tool calls.

## Proposed Changes

### agent_router (Python/FastAPI)

#### [MODIFY] [main.py](file:///home/peter/Documents/tavern_swiper/services/agent_router/main.py)

Add a `POST /invoke-async` endpoint (same as Option A):

- Accepts `InvokeRequest` plus optional `delivery_url` and `delivery_headers`
- Returns `202 Accepted` immediately
- Spawns a background task that invokes the graph
- **Key difference from Option A**: No callback after completion. The LLM delivers via tool calls during graph execution. The background task just needs to log success/failure.
- On LLM failure, POSTs an error notification to `delivery_url` so bots_go knows the agent failed.

#### [NEW] [tools/send_message.py](file:///home/peter/Documents/tavern_swiper/services/agent_router/tools/send_message.py)

New LangGraph tool:

```python
@tool
def send_message(
    content: str,
    message_type: str = "message",
    config: RunnableConfig,
) -> str:
    """Send a message or narration to the current conversation.

    Call this tool to deliver your response to the adventurer.
    You MUST call this tool for every piece of content you want to send.

    Args:
        content: The text to send.
        message_type: Either "message" (dialogue) or "narration" (3rd person action/scene).
    """
    configurable = config.get("configurable", {})
    delivery_url = configurable.get("delivery_url", "")
    delivery_headers = configurable.get("delivery_headers", {})
    conversation_id = configurable.get("conversation_id", "")
    bot_profile_id = configurable.get("bot_profile_id", "")
    sender_profile_id = configurable.get("sender_profile_id", "")
    behavior_type = configurable.get("behavior_type", "")
    agent_name = configurable.get("bot_name", "")

    if not delivery_url:
        return "Error: no delivery URL configured."

    payload = {
        "content": content,
        "message_type": message_type,  # "message" or "narration"
        "conversation_id": conversation_id,
        "bot_profile_id": bot_profile_id,
        "sender_profile_id": sender_profile_id,
        "behavior_type": behavior_type,
        "agent_name": agent_name,
    }

    resp = requests.post(
        delivery_url,
        json=payload,
        headers=delivery_headers,
        timeout=10,
    )

    if resp.status_code >= 400:
        return f"Delivery failed (HTTP {resp.status_code})"

    return "Message delivered."
```

**Design note**: The tool pulls delivery context from `RunnableConfig.configurable` (injected by the `/invoke-async` handler), keeping the tool signature clean — the LLM only provides `content` and `message_type`.

#### [MODIFY] Agent definitions ([grogmar.py](file:///home/peter/Documents/tavern_swiper/services/agent_router/agents/grogmar.py), [lira.py](file:///home/peter/Documents/tavern_swiper/services/agent_router/agents/lira.py), etc.)

For each agent:

1. Add `send_message` to the `TOOLS` list:
   ```python
   from tools.send_message import send_message
   TOOLS = [get_my_checkpoints, complete_checkpoint, send_message]
   ```

2. Update the system prompt's RESPONSE FORMAT section to instruct tool-based delivery:
   ```
   RESPONSE FORMAT:
   You MUST use the send_message tool to deliver every piece of your response.
   - Call send_message with message_type="message" for dialogue (things you say out loud).
   - Call send_message with message_type="narration" for scene-setting and actions (always 3rd person).
   - You may call send_message multiple times to interleave messages and narrations.
   - After calling send_message for all items, your text response should be empty or a brief confirmation.
   - NEVER include your response as plain text — always deliver via the tool.
   ```

---

### bots_go (Go/Gin)

#### [NEW] Handler: `handleAgentDelivery` in [behaviors.go](file:///home/peter/Documents/tavern_swiper/services/bots/bots_go/behaviors.go)

Receives individual message deliveries from the send_message tool:

```go
type AgentDeliveryRequest struct {
    Content          string `json:"content"`
    MessageType      string `json:"message_type"` // "message" or "narration"
    ConversationID   string `json:"conversation_id"`
    BotProfileID     string `json:"bot_profile_id"`
    SenderProfileID  string `json:"sender_profile_id"`
    BehaviorType     string `json:"behavior_type"`
    AgentName        string `json:"agent_name"`
}
```

Handler logic:
1. Authenticate the bot user (look up by bot_profile_id → bot_user_id → authenticateBotUser)
2. Based on `message_type`:
   - `"message"` → `postBotMessage(token, conversationID, botProfileID, content)`
   - `"narration"` → `postBotNarration(token, conversationID, botProfileID, content)`
3. Optionally fire `tryCompleteQuest()` on each delivery (or only on the last one — see open questions)
4. Return `200 OK` to the tool so the LLM knows delivery succeeded

#### [MODIFY] [main.go](file:///home/peter/Documents/tavern_swiper/services/bots/bots_go/main.go)

Register the delivery endpoint:
```go
authorized.POST("/bots/agent-delivery", handleAgentDelivery)
```

#### [MODIFY] [behaviors.go](file:///home/peter/Documents/tavern_swiper/services/bots/bots_go/behaviors.go)

Modify `behaviorBotReply` to fire-and-forget:
- Replace `callAgentRouter()` + `parseAgentResponse()` + `postBotMessage()` with `callAgentRouterAsync()`:
  - POSTs to `/invoke-async` with `delivery_url` pointing to `<BOTS_SERVICE_URL>/bots/agent-delivery`
  - Passes conversation context in the request so it flows into `RunnableConfig.configurable`
- Returns immediately — no waiting for the AI response.
- The `parseAgentResponse()` function becomes unused and can be removed (delivery is per-item via tool calls).

#### [MODIFY] [models.go](file:///home/peter/Documents/tavern_swiper/services/bots/bots_go/models.go)

Add `AgentDeliveryRequest` struct (see above).

---

### bots_subscriber

No changes needed.

## How the send_message Tool Replaces Structured Response Parsing

Today's flow:
```
LLM generates: [{"type":"message","content":"OI!"}, {"type":"narration","content":"Grogmar slams..."}]
bots_go parses JSON array → posts each item as a separate message
```

With the tool:
```
LLM calls: send_message(content="Grogmar slams a tankard down.", message_type="narration")
           → tool POSTs to bots_go → message posted
LLM calls: send_message(content="OI! WELCOME!", message_type="message")
           → tool POSTs to bots_go → message posted
LLM generates: "" (empty final response, or "Messages delivered.")
```

The structured JSON array format is no longer needed. Each delivery is atomic and typed.

## Edge Cases & Failure Modes

| Scenario | Handling |
|----------|----------|
| **LLM forgets to call send_message** | User gets silence. Mitigate with strong prompt engineering and testing. Consider a "watchdog" timer in bots_go: if no delivery arrives within N minutes of an async invoke, log a warning. |
| **LLM calls send_message with wrong message_type** | Low risk — the LLM only has two options ("message" / "narration"). Default unknown types to "message". |
| **Multiple send_message calls arrive out of order** | Add a `sequence_number` field to deliveries. bots_go can buffer and reorder, or accept eventual ordering (messages have timestamps). |
| **LLM calls send_message too many times** | Rate limit at bots_go: reject deliveries beyond a reasonable count (e.g., 10) per conversation per minute. |
| **Tool call fails (network error)** | The LLM sees "Delivery failed" as the tool response and may retry or generate an error message. LangGraph's tool retry logic can help. |
| **Bot JWT expiry** | Same as Option A — `handleAgentDelivery` must re-authenticate the bot user for each delivery. |

## Quest Completion Considerations

Today, `tryCompleteQuest("meet_the_tavern_keepers", ...)` fires after the *entire* reply is posted. With per-item delivery, two options:

**Option 1 — Fire on every delivery**: Simple but redundant. `tryCompleteQuest` is idempotent (409 = already done), so firing it 3 times for a 3-item response is harmless.

**Option 2 — Separate "delivery complete" signal**: After the LLM finishes all tool calls and the graph ends, agent_router sends a "done" notification to a separate bots_go endpoint. bots_go fires quest logic there. This is cleaner but adds complexity.

**Recommendation**: Option 1. Idempotency makes the redundancy free.

## Prompt Engineering Impact

This is the biggest risk factor. Every agent needs its RESPONSE FORMAT section rewritten. The current format asks agents to produce a JSON array — which is deterministic and easy to validate. The new format asks agents to call a tool — which adds:

- A new instruction block explaining `send_message`
- The constraint "NEVER respond with plain text, ALWAYS use the tool"
- Risk of the LLM outputting a hybrid (tool calls + text)
- Risk of the LLM outputting the old JSON array format out of habit (especially with existing thread history)

**Mitigation**: During migration, keep the JSON parsing as a fallback in `bots_go`. If the agent_router receives a non-empty final AI message (meaning the LLM didn't use the tool), it can fall back to the callback pattern to deliver it.

## Future Unlocks

This pattern enables capabilities that the callback pattern cannot:

1. **Proactive messaging**: A scheduled job calls `/invoke-async` with a system prompt like "Check in on the adventurer, it's been 24 hours since they last visited." The LLM calls `send_message` to initiate a conversation unprompted.

2. **Multi-turn tool chains with intermediate messages**: The LLM could send "Hang on, let me check something..." before calling a slow tool, then send the actual response after. Today this is impossible because bots_go only posts after the entire LLM response is complete.

3. **Agent-to-agent communication**: One agent could send a message to another agent's conversation — e.g., Lira mentions "Grogmar told me about you" by calling a cross-conversation tool.

4. **Streaming-like UX**: Individual `send_message` calls arrive as the LLM processes, giving users partial responses before the full generation is complete.

## Comparison with Option A (Callback)

| Dimension | Callback (Option A) | Tool (Option B) |
|-----------|---------------------|-----------------|
| **Delivery reliability** | Deterministic — always delivers if AI returns anything | LLM-dependent — must call tool correctly |
| **agent_router coupling** | Minimal — just learns "POST to URL when done" | Moderate — new tool, configurable injection |
| **Prompt changes** | None — response format stays the same | All agents need RESPONSE FORMAT rewrite |
| **Parsing complexity** | Same as today (JSON array + fallback) | Eliminated — each delivery is atomic |
| **Future autonomy** | Limited — agent can only respond when asked | Full — agent can initiate messages anytime |
| **Implementation effort** | Lower — mostly plumbing changes | Higher — tool + prompt engineering + testing |
| **Risk** | Low — refactoring existing patterns | Medium — new LLM dependency in delivery path |

## Migration Path

1. **Phase 1**: Add `send_message` tool and `/invoke-async` to agent_router. Test with a single agent (Grogmar) in dev.
2. **Phase 2**: Add `handleAgentDelivery` to bots_go. Keep `callAgentRouter()` (sync) as fallback behind `USE_ASYNC_AGENT` env var.
3. **Phase 3**: Update all agent system prompts. Keep JSON array parsing as a fallback for transition period.
4. **Phase 4**: Once all agents are validated, remove sync path and JSON parsing fallback.

## Open Questions

1. **Message ordering**: Should `send_message` include a sequence number, or is insertion-order good enough? If the LLM makes parallel tool calls, bots_go might receive them out of order.
2. **Quest timing**: Should quest completion fire per-delivery (idempotent) or only after a "conversation turn complete" signal?
3. **Fallback behavior**: If the LLM returns a non-empty text response AND calls `send_message`, should bots_go post both? Only the tool-delivered content? This needs a clear policy.
4. **Rate limiting**: What's the max number of `send_message` calls per turn? The current structured format caps at ~5-10 items per response. Should the tool enforce a similar limit?
5. **Thread history pollution**: Each `send_message` tool call and result appears in the LangGraph thread checkpoint. Over many turns, this could bloat the thread state. Is this a concern?
