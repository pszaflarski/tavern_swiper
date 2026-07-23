"""Vector memory & atomic fact extraction for agent_router_worker."""

import logging
import os
import datetime
from google.cloud import firestore
from google.cloud.firestore_v1.vector import Vector

logger = logging.getLogger(__name__)

_embedding_model = None


def _get_model():
    global _embedding_model
    if _embedding_model is None:
        from fastembed import TextEmbedding
        cache_dir = os.getenv("FASTEMBED_CACHE_PATH")
        _embedding_model = TextEmbedding("BAAI/bge-small-en-v1.5", cache_dir=cache_dir)
        logger.info("Loaded embedding model BAAI/bge-small-en-v1.5 from cache_dir=%s", cache_dir)
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
    category: str = "general",
) -> str:
    """Embed and store a memory document. Returns the document ID."""
    embedding = get_embedding(text)
    doc_ref = db.collection("agent_memories").document()
    doc_ref.set({
        "agent_id": agent_id,
        "thread_id": thread_id,
        "text": text,
        "category": category,
        "embedding": Vector(embedding),
        "created_at": firestore.SERVER_TIMESTAMP,
    })
    logger.info("Stored memory %s for agent=%s thread=%s category=%s", doc_ref.id, agent_id, thread_id, category)
    return doc_ref.id


def retrieve_memories(
    db: firestore.Client,
    thread_id: str,
    query_text: str,
    limit: int = 3,
) -> list[str]:
    """Retrieve top memories scoped to the active thread using a hybrid (recency + relevance) approach."""
    collection = db.collection("agent_memories")
    docs = list(collection.where("thread_id", "==", thread_id).stream())
    if not docs:
        logger.info("No memories found for thread %s", thread_id)
        return []

    memories = []
    for doc in docs:
        data = doc.to_dict()
        created_at = data.get("created_at")
        if created_at is None:
            created_at = datetime.datetime.now(datetime.timezone.utc)
        
        vector_obj = data.get("embedding")
        vector_list = []
        if vector_obj:
            if hasattr(vector_obj, "to_list"):
                vector_list = vector_obj.to_list()
            elif isinstance(vector_obj, list):
                vector_list = vector_obj
            else:
                vector_list = list(vector_obj)
                
        memories.append({
            "text": data.get("text", ""),
            "created_at": created_at,
            "embedding": vector_list
        })

    query_vector = get_embedding(query_text)
    scored_memories = []
    for m in memories:
        emb = m["embedding"]
        if emb and len(emb) == len(query_vector):
            sim = sum(a * b for a, b in zip(query_vector, emb))
        else:
            sim = 0.0
        scored_memories.append((sim, m))

    scored_memories.sort(key=lambda x: x[0], reverse=True)
    memories.sort(key=lambda x: x["created_at"], reverse=True)

    combined = []
    seen_texts = set()

    if limit <= 1:
        for sim, m in scored_memories:
            txt = m["text"]
            if txt and txt not in seen_texts:
                combined.append(txt)
                seen_texts.add(txt)
    else:
        recent_mems = memories[:1]
        for m in recent_mems:
            txt = m["text"]
            if txt and txt not in seen_texts:
                combined.append(txt)
                seen_texts.add(txt)
        for sim, m in scored_memories:
            txt = m["text"]
            if txt and txt not in seen_texts:
                combined.append(txt)
                seen_texts.add(txt)

    results = combined[:limit]
    logger.info("Retrieved %d hybrid memories for thread %s", len(results), thread_id)
    return results


def reconcile_and_store_facts(
    db: firestore.Client,
    agent_id: str,
    thread_id: str,
    facts: list[dict],
) -> int:
    """Store extracted atomic facts into agent_memories, updating or inserting as necessary."""
    stored_count = 0
    for item in facts:
        text = item.get("text", "").strip()
        category = item.get("category", "general")
        if not text:
            continue
        store_memory(db=db, agent_id=agent_id, thread_id=thread_id, text=text, category=category)
        stored_count += 1
    logger.info("Reconciled and stored %d facts for thread %s", stored_count, thread_id)
    return stored_count
