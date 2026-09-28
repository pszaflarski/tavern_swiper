# Conversation Novel Generator

Transform a Tavern Swiper conversation into a richly detailed fantasy novel.

## How It Works

Uses a **3-phase hierarchical pipeline** that mirrors the agent router's own context management (rolling summaries + vector memory retrieval):

```
Phase 1: Chunked Summarization          Phase 2: Chapter Planning
┌──────────────────────────────┐       ┌──────────────────────────────┐
│ 1214 messages                │       │ 41 summaries (~6K words)     │
│ → chunks of 30               │       │ → LLM analyzes narrative arc │
│ → summarize each (~150 words)│──────▶│ → identifies chapter breaks  │
│ = ~41 compact summaries      │       │ = 16 chapters with titles    │
└──────────────────────────────┘       └──────────────────────────────┘
                                                    │
Phase 3: Chapter Writing with Context Enrichment    │
┌──────────────────────────────────────────────┐    │
│ For each chapter:                            │◀───┘
│  • Raw messages (full dialogue detail)       │
│  • Rolling summary of ALL prior chapters     │
│  • Next chapter synopsis (pacing awareness)  │
│  → Write 1500-3000 words of literary prose   │
└──────────────────────────────────────────────┘
```

### Why not dump everything into one LLM call?

| Approach | Tokens In | Quality |
|----------|-----------|---------|
| Brute force (all 1214 msgs) | ~200K tokens | LLM forced to compress; loses detail |
| **Smart pipeline** | ~6K tokens for planning, ~5-15K per chapter | Each chapter gets full context window for max detail |

### How it mirrors existing infrastructure

| Pipeline Phase | Existing Agent Router Pattern |
|---|---|
| Phase 1: Chunk & Summarize | `migrate_vector_memories.py` (chunks of 30) |
| Phase 2: Plan from summaries | `make_summarize_node` (rolling summary for context) |
| Phase 3: Rolling context | `get_recalled_memories_context` (vector recall) |

## Prerequisites

- Google Cloud ADC configured (`gcloud auth application-default login`)
- Python 3.12+ with project virtualenv
- Agent router running (locally or Cloud Run dev)

## Usage

### Using Cloud Run dev agent router (default)

```bash
# From project root
.venv/bin/python3 examples/conversation_novel/generate_novel.py \
    --conversation-id <CONVERSATION_ID> \
    --env prod
```

### Using local agent router

```bash
# Terminal 1: Start the agent router locally
cd services/agent_router
python main.py

# Terminal 2: Run the generator
.venv/bin/python3 examples/conversation_novel/generate_novel.py \
    --conversation-id <CONVERSATION_ID> \
    --env prod \
    --local
```

### Example: The Keziah & Lira Story

```bash
.venv/bin/python3 examples/conversation_novel/generate_novel.py \
    --conversation-id 5200eccd-882f-4441-9765-5f519f060f4e \
    --env prod \
    --local
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--conversation-id` | (required) | Firestore conversation ID |
| `--env` | `dev` | Environment to read messages from (`dev`, `test`, `prod`) |
| `--local` | `false` | Use local agent router at `localhost:8000` |
| `--agent-router-url` | auto-discover | Override agent router URL |
| `--output`, `-o` | auto-generated | Output file path |
| `--model` | `gemini-2.5-flash` | LLM model to use |
| `--chunk-size` | `30` | Messages per summary chunk in Phase 1 |

## Output

The script generates a markdown file in `examples/conversation_novel/output/` with:

- **Title page** with novel title and tagline
- **Character list** with resolved display names
- **Synopsis** (back-cover blurb)
- **Table of contents** with chapter titles
- **Chapters** with richly detailed prose

## Architecture Notes

- **Phase 1 (Summarize)**: Mirrors `migrate_vector_memories.py` — chunks of 30 messages are each summarized into ~150 words, creating a compressed "timeline" of the entire conversation.
- **Phase 2 (Plan)**: The chapter planner receives only ~6K words of summaries instead of 200K+ tokens of raw messages. It can easily analyze the full narrative arc.
- **Phase 3 (Write)**: Each chapter receives its raw messages (for dialogue fidelity) plus a rolling summary of all preceding chapters (for backstory continuity). This mirrors how the agent router's `make_summarize_node` provides compacted history.
- **Fresh thread per call**: Each `/invoke` call uses a new `thread_id` to prevent cross-chapter context pollution.
- **Decoupled environments**: You can read messages from `prod` while routing AI calls through the `dev` agent router.
