# Next Steps: LangGraph Context Compression Design

This document details the planned design for optimizing LLM token usage and latency in the `agent_router` using LangGraph context compression.

## The Goal
Currently, the agent router retrieves the entire conversation history from the checkpointer (MongoDB or SQLite) and sends the complete list of messages to the LLM on every turn. As conversations grow, this uses an increasing number of tokens, increases latency, and can eventually exceed the model's context window.

We want to adopt **Method 1 (Message Trimming)** while keeping the full history in the database, and eventually add a specialized **Message Search Tool** to retrieve older messages if needed.

---

## Recommended Strategy: Message Trimming (Non-Destructive)

This approach leaves the full conversation history intact in the persistence database (which is critical so the React Native frontend can still load the complete chat logs), but dynamically prunes the history sent to the LLM.

### 1. LangChain Message Trimming
Use LangChain's built-in `trim_messages` function (imported from `langchain_core.messages`) inside each agent's node creation loop (e.g. `_make_node` in `services/agent_router/agents/base.py` or individual agents).

```python
from langchain_core.messages import trim_messages

# Trimmer configuration
trimmer = trim_messages(
    strategy="last",
    max_tokens=4000,                  # Target token limit
    token_counter=llm,                # Use model's token counter
    start_on="human",                 # Make sure the context slice begins with a HumanMessage
    include_system=False,             # Keep system prompt handling separate
    allow_partial=False,
)

# Application inside the node:
# trimmed_history = trimmer.invoke(state["messages"])
# messages = [SystemMessage(content=SYSTEM_PROMPT), *trimmed_history]
```

### 2. Message Search Tool (Future Addition)
Because older messages are discarded from the LLM prompt by the trimmer, the agent will lose immediate visibility of messages beyond the token threshold. To mitigate this:
* Equip the agent with a `search_past_messages` tool.
* When the agent needs to recall a specific detail (e.g. "What did the traveler say their hometown was?"), it can call this tool.
* The tool will search the database (SQLite/MongoDB) or run semantic/vector search over the full conversation history and return matching message snippets.

---

## Alternative Strategies Considered

### Method 2: Conversation Summarization & State Pruning (State-Level/Destructive)
A loop node in the graph digests the oldest messages and updates a running `summary` field in the graph state, replacing the old messages with `RemoveMessage(id=msg.id)` instructions.
* **Pros**: Retains high-level context of older interactions without high token count.
* **Cons**: Summarization calls cost extra LLM tokens; permanently removes raw messages from the graph state (making them unretrievable via normal LangGraph state inspection).

### Method 3: Sliding Window Reducer
Replace the default `add_messages` state reducer with a custom python function that only stores the last `N` messages in the state array.
* **Pros**: Simple to configure on `MessagesState`.
* **Cons**: Hard-deletes messages beyond the window count from the checkpointer database.
