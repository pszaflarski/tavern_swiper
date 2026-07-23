"""Memory Worker: Atomic fact extraction, HyDE question generation, and Firestore vector memory storage."""

import logging
import json
import os
from persistence.firestore_native import get_firestore_client
from persistence.vector_memory import reconcile_and_store_facts

logger = logging.getLogger(__name__)


def extract_atomic_facts_and_hyde(history_text: str, agent_id: str) -> list[dict]:
    """Extract sharp atomic facts from history and generate hypothetical questions for vector indexing."""
    from langchain_core.messages import SystemMessage, HumanMessage
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_openai import ChatOpenAI

    # Fallback/default LLM selection for worker
    api_key = os.getenv("GOOGLE_AI_STUDIO_API_KEY") or os.getenv("OPENAI_API_KEY")
    if os.getenv("GOOGLE_AI_STUDIO_API_KEY"):
        llm = ChatGoogleGenerativeAI(model="gemini-1.5-flash", google_api_key=os.getenv("GOOGLE_AI_STUDIO_API_KEY"))
    elif os.getenv("OPENAI_API_KEY"):
        llm = ChatOpenAI(model="gpt-4o-mini", openai_api_key=os.getenv("OPENAI_API_KEY"))
    else:
        logger.warning("No API keys found for LLM fact extraction. Storing raw history summary.")
        return [{"text": history_text[:500], "category": "summary"}]

    prompt = f"""You are a Memory Processing Worker for an RPG AI Agent named '{agent_id}'.
Analyze the following conversation history and extract key atomic facts.
Categorize each fact as one of: 'inventory', 'lore', 'relationship', 'quest', or 'general'.
For each fact, also write 1-2 hypothetical questions an adventurer might ask that would be answered by this fact.

Return ONLY a JSON array of objects with keys: "text", "category", and "questions".

Example format:
[
  {{
    "text": "The Adventurer gave Lira a glowing blue potion of secrets.",
    "category": "inventory",
    "questions": ["Did I give Lira anything?", "What potion does Lira have?"]
  }}
]

Conversation History:
{history_text}
"""

    try:
        response = llm.invoke([
            SystemMessage(content="You process RPG dialogue into structured atomic facts."),
            HumanMessage(content=prompt)
        ])
        content = str(response.content).strip()
        # Clean markdown codeblocks if present
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        
        parsed = json.loads(content.strip())
        if isinstance(parsed, list):
            results = []
            for item in parsed:
                fact_text = item.get("text", "")
                cat = item.get("category", "general")
                questions = item.get("questions", [])
                results.append({"text": fact_text, "category": cat})
                # Include hypothetical questions to enhance vector similarity matching
                for q in questions:
                    if q:
                        results.append({"text": f"[Q: {q}] -> {fact_text}", "category": cat})
            return results
    except Exception as e:
        logger.error("Failed to extract atomic facts: %s", e)

    return [{"text": history_text[:500], "category": "summary"}]


def process_memory_event(thread_id: str, agent_id: str, history_text: str) -> dict:
    """Process a memory event out-of-band: extract facts and write to Firestore agent_memories."""
    logger.info("⚙️ [WORKER RUNNING] Processing memory extraction [thread_id=%s, agent_id=%s, input_len=%d]", thread_id, agent_id, len(history_text))
    db = get_firestore_client()
    
    facts = extract_atomic_facts_and_hyde(history_text, agent_id)
    count = reconcile_and_store_facts(db=db, agent_id=agent_id, thread_id=thread_id, facts=facts)
    
    logger.info("✅ [WORKER COMPLETED] Fact extraction and vector indexing finished [thread_id=%s, facts_stored=%d]", thread_id, count)
    return {
        "status": "success",
        "thread_id": thread_id,
        "agent_id": agent_id,
        "facts_stored": count,
    }
