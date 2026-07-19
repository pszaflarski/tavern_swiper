# Next Steps: Firestore Vector Memory Design & Roadmap

This document outlines the design, implementation, and verification steps for adding a self-hosted vector database using Cloud Firestore and a local embedding model. This enables agents to retrieve relevant historical conversation snippets without exceeding their active context window or exposing transcripts to external safety filters.

---

## 1. Design Overview

To keep the system cost-effective, private, and independent of external embedding APIs:
* **Embeddings:** Generated locally inside the `agent_router` using the **`fastembed`** library.
* **Model:** **`BAAI/bge-small-en-v1.5`** (quantized ONNX version, ~67 MB disk/RAM, 384 dimensions).
* **Storage & Retrieval:** Cloud Firestore (Enterprise Native) which natively supports K-Nearest Neighbor (KNN) vector queries.

```
+------------------+     1. Embed query (Local)     +-------------------+
|                  | -----------------------------> |     fastembed     |
|   agent_router   |                                |  (bge-small-v1.5) |
|                  | <----------------------------- +-------------------+
+------------------+      384-dim Vector Float
       |
       | 2. Vector Search (KNN + pre_filter)
       v
+------------------+
|    Firestore     | (Collection: `agent_memories`)
+------------------+
```

---

## 2. Implementation Steps

### Step A: Configure Dependencies
Add the lightweight embedding engine to the Python requirements:

Modify [requirements.txt](file:///home/peter/Documents/tavern_swiper/services/agent_router/requirements.txt):
```text
fastembed==0.34.0
```

### Step B: Define Memory Schema
Memories will be summarized historical conversation blocks saved to the `agent_memories` collection:

```json
{
  "id": "mem_uuid",
  "agent_id": "lira",
  "thread_id": "thread_uuid",
  "text": "Adventurer gave Lira a secret potion to restore her memory.",
  "embedding": [0.124, -0.053, ...], // 384-dimensional float array
  "created_at": "timestamp"
}
```

### Step C: Create the Firestore Vector Index
Firestore requires a composite index to run vector search. Run this Google Cloud command to create it:

```bash
gcloud alpha firestore indexes composite create \
  --collection-group=agent_memories \
  --query-scope=COLLECTION \
  --field-config=field-path=embedding,vector-config='{"dimension":"384","flat-index":{}}' \
  --project=tavern-swiper-dev
```

### Step D: Embedding and Query Ingestion
Initialize the embedding model and perform search within the LangGraph nodes:

```python
from fastembed import TextEmbedding
from google.cloud import firestore

# Initialize model (downloads BGE-small to local cache once, then loads on CPU)
embedding_model = TextEmbedding("BAAI/bge-small-en-v1.5")

def get_embedding(text: str) -> list[float]:
    """Generate 384-dimensional vector embedding for given text."""
    embeddings = list(embedding_model.embed([text]))
    return embeddings[0].tolist()

def retrieve_memories(db: firestore.Client, thread_id: str, query_text: str) -> list[str]:
    """Retrieve top 3 matching memories scoped to the active thread."""
    query_vector = get_embedding(query_text)
    
    collection = db.collection("agent_memories")
    
    # CRITICAL: Always use pre_filter (e.g. by thread_id) to prune metadata 
    # space before running vector calculations to conserve Firestore CPU.
    query = collection.find_nearest(
        vector_field="embedding",
        query_vector=query_vector,
        distance_measure=firestore.DistanceMeasure.COSINE,
        limit=3,
        pre_filter=firestore.FieldFilter("thread_id", "==", thread_id)
    )
    
    return [doc.to_dict()["text"] for doc in query.get()]
```

---

## 3. Observability & Verification

To verify that the vector database is active, indexing correctly, and actively enriching agent context, perform the following checks:

### 1. Firestore Index Validation
Firestore vector search queries will return a hard error if the index is missing or building. Check the build status via GCP:
```bash
gcloud firestore indexes composite list --project=tavern-swiper-dev
```
Ensure the state of the `agent_memories` index displays **`READY`**.

### 2. Integration / Search Validation Script
Add a temporary test script inside `services/agent_router/tests/test_vector.py` to assert that semantic search is working end-to-end:

```python
import time
from fastembed import TextEmbedding
from google.cloud import firestore

db = firestore.Client(database="router-dev")
model = TextEmbedding("BAAI/bge-small-en-v1.5")

def embed(text: str):
    return list(model.embed([text]))[0].tolist()

# 1. Seed distinct test memories
test_thread = f"test-thread-{int(time.time())}"
memories = [
    {"text": "The secret code to the chest is 8849.", "embedding": embed("The secret code to the chest is 8849.")},
    {"text": "We met an old wizard named Elidor in the forest.", "embedding": embed("We met an old wizard named Elidor in the forest.")}
]

col_ref = db.collection("agent_memories")
for m in memories:
    col_ref.add({**m, "thread_id": test_thread, "created_at": firestore.SERVER_TIMESTAMP})

# Give Firestore time to write
time.sleep(2)

# 2. Perform semantic query
query_vector = embed("What was the password for the box?")
results = col_ref.find_nearest(
    vector_field="embedding",
    query_vector=query_vector,
    distance_measure=firestore.DistanceMeasure.COSINE,
    limit=1,
    pre_filter=firestore.FieldFilter("thread_id", "==", test_thread)
)

# 3. Assert correct recall
for doc in results.get():
    data = doc.to_dict()
    print(f"Nearest Match: '{data['text']}'")
    assert "8849" in data['text'], "Failed to retrieve correct semantic match!"
    print("SUCCESS: Vector similarity query verified.")
```

### 3. Prompt Context Ingestion Logging
Verify that retrieved context is injected into agent prompts by logging the output directly during runtime:

```python
# In agent_router execution loop
memories = retrieve_memories(db, thread_id, user_message)
logger.info(f"Retrieved memories for thread {thread_id}: {memories}")

# Inject into the active prompt
system_prompt_enriched = f"{base_system_prompt}\n\n[Recalled Memories]:\n" + "\n".join(f"- {m}" for m in memories)
```
Monitor the runtime logs of the `agent-router` container (e.g. `gcloud beta run logs tail agent-router-dev`) to ensure context payloads are loading correctly.
