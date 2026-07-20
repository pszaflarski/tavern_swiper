# Next Steps: Firestore Vector Memory Design & Roadmap

This document outlines the design, implementation, and verification steps for adding a self-hosted vector database using Cloud Firestore and a local embedding model. This enables agents to retrieve relevant historical conversation snippets without exceeding their active context window or exposing transcripts to external safety filters.

---

## 1. Design Overview

To keep the system cost-effective, private, and independent of external embedding APIs:
* **Embeddings:** Generated locally inside the `agent_router` using the **`fastembed`** library.
* **Model:** **`BAAI/bge-small-en-v1.5`** (quantized ONNX version, ~67 MB disk/RAM, 384 dimensions).
* **Storage & Retrieval:** Cloud Firestore Enterprise Native — the **same** `router-{env}` database already used for MongoDB-compatible checkpointing, but accessed via the **native Firestore Python SDK** for vector operations.

### Why Two Protocols on One Database?

Firestore Enterprise databases support **dual-protocol access**: the MongoDB wire protocol (used by `pymongo` for LangGraph checkpointing) and the native Firestore SDK (used for vector search via `find_nearest()`). Both protocols read/write to the same underlying database.

MongoDB's `$vectorSearch` aggregation stage is **not supported** on Firestore's MongoDB compatibility layer, but Firestore's native `find_nearest()` KNN API **is** supported on Enterprise databases. This is the correct and documented approach.

```
+------------------+     1. Embed query (Local)     +-------------------+
|                  | -----------------------------> |     fastembed     |
|   agent_router   |                                |  (bge-small-v1.5) |
|                  | <----------------------------- +-------------------+
+------------------+      384-dim Vector Float
       |
       | 2a. Checkpointing (MongoDB wire protocol via pymongo) — existing
       | 2b. Vector Search  (Native Firestore SDK via find_nearest) — new
       v
+------------------+
|    Firestore     | (Database: `router-{env}`, Enterprise Native)
|                  | (Collection: `agent_memories`)
+------------------+
```

---

## 2. Implementation Steps

### Step A: Configure Dependencies
Add the lightweight embedding engine and the native Firestore SDK to the Python requirements.

Modify `services/agent_router/requirements.txt`:
```text
# Vector memory
fastembed>=0.4.0
google-cloud-firestore>=2.19.0
```

> **Note:** `google-cloud-firestore` is the native Firestore Python SDK. It is separate from the `pymongo` driver already used for checkpointing. Both coexist and talk to the same database.

### Step B: Define Memory Schema
Memories are summarized historical conversation blocks saved to the `agent_memories` collection in the existing `router-{env}` database:

```json
{
  "id": "mem_uuid",
  "agent_id": "lira",
  "thread_id": "thread_uuid",
  "text": "Adventurer gave Lira a secret potion to restore her memory.",
  "embedding": "<Vector(384 dimensions)>",
  "created_at": "timestamp"
}
```

When writing documents, the embedding field **must** use the Firestore `Vector` class so the database recognizes it as a vector type:

```python
from google.cloud.firestore_v1.vector import Vector

doc_data = {
    "agent_id": agent_id,
    "thread_id": thread_id,
    "text": summary_text,
    "embedding": Vector(embedding_floats),  # NOT a raw list
    "created_at": firestore.SERVER_TIMESTAMP,
}
```

### Step C: Create the Firestore Vector Index
Firestore requires a composite index to run vector search. Run this Google Cloud command to create it:

```bash
# Dev environment
gcloud alpha firestore indexes composite create \
  --collection-group=agent_memories \
  --query-scope=COLLECTION \
  --database=router-dev \
  --field-config=field-path=embedding,vector-config='{"dimension":"384","flat":{}}' \
  --field-config=field-path=thread_id,order=ASCENDING \
  --project=tavern-swiper-dev

# Prod environment
gcloud alpha firestore indexes composite create \
  --collection-group=agent_memories \
  --query-scope=COLLECTION \
  --database=router-prod \
  --field-config=field-path=embedding,vector-config='{"dimension":"384","flat":{}}' \
  --field-config=field-path=thread_id,order=ASCENDING \
  --project=tavern-swiper-prod
```

> **Key details:**
> - `--database=router-{env}` targets the existing Firestore Enterprise database (not `(default)`)
> - `"flat":{}` is the correct syntax (not `"flat-index":{}`)
> - `thread_id` field config is included for composite pre-filter support

### Step D: Firestore Client Initialization
Create a new module for the native Firestore client that connects to the **same** `router-{env}` database:

**New file:** `services/agent_router/persistence/firestore_native.py`
```python
"""Native Firestore client for vector search on the router-{env} database.

This coexists with the MongoDB wire protocol used by mongodb_handler.py.
Both protocols access the same underlying Firestore Enterprise database.
"""

import os
import logging
from google.cloud import firestore

logger = logging.getLogger(__name__)

_client: firestore.Client | None = None


def get_firestore_client() -> firestore.Client:
    """Return a singleton native Firestore client for the router database."""
    global _client
    if _client is not None:
        return _client

    env = os.getenv("ENV", "dev")
    database_id = f"router-{env}"

    _client = firestore.Client(database=database_id)
    logger.info("Initialized native Firestore client for database '%s'", database_id)
    return _client
```

### Step E: Embedding and Query Module
Create a dedicated module for embedding generation and memory retrieval:

**New file:** `services/agent_router/persistence/vector_memory.py`
```python
"""Vector memory: embed text and search agent_memories via Firestore KNN."""

import logging
from google.cloud import firestore
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

logger = logging.getLogger(__name__)

# Lazy-loaded embedding model (avoids blocking startup)
_embedding_model = None


def _get_model():
    global _embedding_model
    if _embedding_model is None:
        from fastembed import TextEmbedding
        _embedding_model = TextEmbedding("BAAI/bge-small-en-v1.5")
        logger.info("Loaded embedding model BAAI/bge-small-en-v1.5")
    return _embedding_model


def get_embedding(text: str) -> list[float]:
    """Generate 384-dimensional vector embedding for given text."""
    embeddings = list(_get_model().embed([text]))
    return embeddings[0].tolist()


def store_memory(
    db: firestore.Client,
    agent_id: str,
    thread_id: str,
    text: str,
) -> str:
    """Embed and store a memory document. Returns the document ID."""
    embedding = get_embedding(text)
    doc_ref = db.collection("agent_memories").document()
    doc_ref.set({
        "agent_id": agent_id,
        "thread_id": thread_id,
        "text": text,
        "embedding": Vector(embedding),
        "created_at": firestore.SERVER_TIMESTAMP,
    })
    logger.info("Stored memory %s for agent=%s thread=%s", doc_ref.id, agent_id, thread_id)
    return doc_ref.id


def retrieve_memories(
    db: firestore.Client,
    thread_id: str,
    query_text: str,
    limit: int = 3,
) -> list[str]:
    """Retrieve top matching memories scoped to the active thread."""
    query_vector = get_embedding(query_text)

    collection = db.collection("agent_memories")

    # Pre-filter by thread_id to prune search space before vector calculations
    vector_query = collection.where(
        "thread_id", "==", thread_id
    ).find_nearest(
        vector_field="embedding",
        query_vector=Vector(query_vector),
        distance_measure=DistanceMeasure.COSINE,
        limit=limit,
    )

    results = []
    for doc in vector_query.get():
        data = doc.to_dict()
        results.append(data["text"])

    logger.info("Retrieved %d memories for thread %s", len(results), thread_id)
    return results
```

### Step F: Memory Ingestion — Hook into Summarization

The existing `make_summarize_node` in `agents/base.py` already generates summaries when conversation history exceeds `MAX_MEMORY_TOKENS`. This is the natural insertion point: **embed and store the summary as a memory before the `RemoveMessage` calls prune the history.**

Add to `agents/base.py` inside `make_summarize_node`, after the summary is generated and before the removals are returned:

```python
# After summary_text is generated, store it as a vector memory
try:
    from persistence.firestore_native import get_firestore_client
    from persistence.vector_memory import store_memory

    fs_db = get_firestore_client()
    store_memory(
        db=fs_db,
        agent_id=prefix,
        thread_id=thread_id,
        text=summary_text,
    )
    logger.info("Stored compaction summary as vector memory for thread %s", thread_id)
except Exception as e:
    logger.error("Failed to store vector memory on compaction: %s", e)
```

### Step G: Context Enrichment — Inject Memories into Agent Prompts

When an agent processes a new message, retrieve relevant memories and inject them into the system prompt. This should happen at the agent node level (in individual agent files like `lira.py`, `grogmar.py`, etc.) or in a shared wrapper:

```python
# In agent execution, before calling the LLM
from persistence.firestore_native import get_firestore_client
from persistence.vector_memory import retrieve_memories

memories = retrieve_memories(
    db=get_firestore_client(),
    thread_id=thread_id,
    query_text=user_message,
    limit=3,
)

if memories:
    memory_block = "\n".join(f"- {m}" for m in memories)
    enriched_prompt = f"{base_system_prompt}\n\n[Recalled Memories]:\n{memory_block}"
```

### Step H: Dockerfile Changes

Two changes to the `Dockerfile`:

1. **Pre-download the embedding model** during build to avoid cold-start downloads from HuggingFace.
2. **Copy the model cache** into the final runtime image.

```dockerfile
# ---------- Stage 1: install deps into a clean layer ----------
FROM python:3.12-slim AS deps

WORKDIR /app

# Install build-time system deps (some wheels need gcc/headers)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Pre-download the embedding model into the build layer
RUN PYTHONPATH=/install/lib/python3.12/site-packages \
    python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"

# ---------- Stage 2: final runtime image ----------
FROM python:3.12-slim

WORKDIR /app

# Copy installed packages
COPY --from=deps /install /usr/local

# Copy the pre-downloaded model cache
COPY --from=deps /root/.cache/fastembed /root/.cache/fastembed

COPY . .

EXPOSE 8000

# uvloop gives ~20-30% faster event loop startup vs default asyncio
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --loop uvloop --workers 1
```

### Step I: Cloud Run Memory Bump

The current deployment uses **512Mi**. Adding ONNX Runtime + the embedding model (~67 MB) + inference working memory (~50 MB) requires more headroom.

Update `cloudbuild.yaml` deploy step:
```yaml
--memory=1Gi
```

### Step J: Environment Variable

Add an `ENV` variable to the Cloud Run deployment so the Firestore native client knows which database to target:

```yaml
# In cloudbuild.yaml deploy --update-env-vars, add:
ENV=$_ENV_NAME
```

---

## 3. Observability & Verification

### 1. Firestore Index Validation
Firestore vector search queries will return a hard error if the index is missing or building. Check the build status via GCP:
```bash
gcloud firestore indexes composite list \
  --database=router-dev \
  --project=tavern-swiper-dev
```
Ensure the state of the `agent_memories` index displays **`READY`**.

### 2. Integration / Search Validation Script
Add a temporary test script inside `services/agent_router/tests/test_vector.py` to assert that semantic search is working end-to-end:

```python
import time
from fastembed import TextEmbedding
from google.cloud import firestore
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.cloud.firestore_v1.vector import Vector

db = firestore.Client(database="router-dev")
model = TextEmbedding("BAAI/bge-small-en-v1.5")

def embed(text: str) -> list[float]:
    return list(model.embed([text]))[0].tolist()

# 1. Seed distinct test memories
test_thread = f"test-thread-{int(time.time())}"
col_ref = db.collection("agent_memories")

memories = [
    {"text": "The secret code to the chest is 8849."},
    {"text": "We met an old wizard named Elidor in the forest."},
]

for m in memories:
    col_ref.add({
        **m,
        "embedding": Vector(embed(m["text"])),
        "thread_id": test_thread,
        "agent_id": "test",
        "created_at": firestore.SERVER_TIMESTAMP,
    })

# Give Firestore time to index
time.sleep(3)

# 2. Perform semantic query
query_vector = embed("What was the password for the box?")
results = col_ref.where(
    "thread_id", "==", test_thread
).find_nearest(
    vector_field="embedding",
    query_vector=Vector(query_vector),
    distance_measure=DistanceMeasure.COSINE,
    limit=1,
)

# 3. Assert correct recall
for doc in results.get():
    data = doc.to_dict()
    print(f"Nearest Match: '{data['text']}'")
    assert "8849" in data['text'], "Failed to retrieve correct semantic match!"
    print("SUCCESS: Vector similarity query verified.")

# 4. Cleanup
for doc in col_ref.where("thread_id", "==", test_thread).stream():
    doc.reference.delete()
print("Cleaned up test documents.")
```

### 3. Prompt Context Ingestion Logging
Verify that retrieved context is injected into agent prompts by logging the output directly during runtime:

```python
# In agent execution loop
memories = retrieve_memories(db, thread_id, user_message)
logger.info(f"Retrieved memories for thread {thread_id}: {memories}")

# Inject into the active prompt
system_prompt_enriched = f"{base_system_prompt}\n\n[Recalled Memories]:\n" + "\n".join(f"- {m}" for m in memories)
```
Monitor the runtime logs of the `agent-router` container (e.g. `gcloud beta run logs tail agent-router-dev`) to ensure context payloads are loading correctly.

---

## 4. Relationship to Context Compression

The `context-compression.md` plan describes a future `search_past_messages` tool that would do semantic/vector search over full conversation history. This vector memory system is the **implementation** of that tool. Once deployed, the `search_past_messages` tool can be implemented as a thin wrapper around `retrieve_memories()`.
