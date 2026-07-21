#!/usr/bin/env python3
"""Migration script to backfill vector memories for existing long chats in dev/prod.

This script scans active threads in the database, checks if they exceed the
token/character threshold, chunks their history, generates summarized vector
memories using the local fastembed engine, and compacts the checkpointer state.
"""

import os
import sys
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("migration")

# Add services/agent_router to python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../services/agent_router")))

# Configure default env vars if not set
os.environ.setdefault("ENV", "dev")
os.environ.setdefault("PERSISTENCE", "MONGODB")

from persistence import get_checkpointer, list_threads
from persistence.firestore_native import get_firestore_client
from persistence.vector_memory import store_memory
from agent_registry import get_agent
from models.factory import get_llm
from langchain_core.messages import SystemMessage, RemoveMessage, HumanMessage, AIMessage

# We use a lower threshold for migration to catch moderately long chats (e.g. 5000 tokens)
MIGRATION_THRESHOLD_TOKENS = 12000 
CHUNK_SIZE = 30 # Number of messages per chunk/chapter

def chunk_messages(messages, chunk_size=30):
    chunks = []
    current_chunk = []
    for m in messages:
        current_chunk.append(m)
        if len(current_chunk) >= chunk_size:
            chunks.append(current_chunk)
            current_chunk = []
    if current_chunk:
        chunks.append(current_chunk)
    return chunks

def format_chunk_as_text(messages, bot_name: str) -> str:
    lines = []
    for m in messages:
        role = "Adventurer" if isinstance(m, HumanMessage) or getattr(m, "type", "") == "human" else bot_name.capitalize()
        lines.append(f"{role}: {m.content}")
    return "\n".join(lines)

def run_migration():
    env = os.getenv("ENV", "dev")
    logger.info("Starting vector memory migration for environment: %s", env)
    
    # 1. Resolve LLM for summarization
    try:
        from model_registry import get_model
        default_model_name = os.getenv("DEFAULT_MODEL", "dolphin")
        model_entry = get_model(default_model_name)
        if not model_entry:
            raise ValueError(f"Default model '{default_model_name}' not found in registry.")
        llm = get_llm(provider=model_entry.provider, model=model_entry.model_id)
        logger.info("Resolved LLM for summarization: %s (provider: %s)", default_model_name, model_entry.provider)
    except Exception as e:
        logger.error("Failed to initialize LLM: %s", e)
        return
        
    # 2. Get checkpointer and list threads
    cp = get_checkpointer()
    db = get_firestore_client()
    
    try:
        threads = list_threads()
    except Exception as e:
        logger.error("Failed to list threads from checkpointer: %s", e)
        return
        
    logger.info("Found %d threads in checkpointer.", len(threads))
    
    processed_count = 0
    migrated_count = 0
    
    for t in threads:
        thread_id = t["thread_id"]
        config = {"configurable": {"thread_id": thread_id}}
        
        # Load thread state
        tup = cp.get_tuple(config)
        if not tup or not tup.checkpoint:
            continue
            
        channel_values = tup.checkpoint.get("channel_values", {})
        messages = channel_values.get("messages", [])
        if not messages:
            continue
            
        processed_count += 1
        
        # Estimate total tokens
        from agents.base import _get_message_tokens
        total_tokens = sum(_get_message_tokens(m) for m in messages)
        
        if total_tokens <= MIGRATION_THRESHOLD_TOKENS:
            logger.info("Thread %s has %d tokens (<= %d). Skipping.", thread_id, total_tokens, MIGRATION_THRESHOLD_TOKENS)
            continue
            
        logger.info("Migrating thread %s (%d messages, ~%d tokens)...", thread_id, len(messages), total_tokens)
        
        # Extract agent_name from checkpoint metadata
        bot_name = tup.metadata.get("agent_name") or tup.metadata.get("run_name")
        if not bot_name:
            # Fallback check: infer from first message or default
            bot_name = "lira" # Safe default for tavern dating app
            
        # Group messages into chunks
        chunks = chunk_messages(messages, CHUNK_SIZE)
        logger.info("Split thread %s into %d chunks.", thread_id, len(chunks))
        
        summaries = []
        
        # Summarize and embed each chunk
        for i, chunk in enumerate(chunks):
            transcript = format_chunk_as_text(chunk, bot_name)
            system_prompt = (
                f"You are a helpful assistant. Write a concise factual summary of the following chat history "
                f"between the Adventurer and the barkeep {bot_name.capitalize()}. "
                f"Focus on key story points, character backgrounds, quest progress, and decisions. "
                f"Keep it under 150 words. Write in plain English as a factual note."
            )
            
            try:
                response = llm.invoke([
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=f"Here is the chat history chunk {i+1}/{len(chunks)}:\n\n{transcript}")
                ])
                summary_text = response.content
                if isinstance(summary_text, list):
                    summary_text = "".join(c.get("text", "") if isinstance(c, dict) else str(c) for c in summary_text)
                summary_text = str(summary_text).strip()
                
                # Store in vector database
                store_memory(db=db, agent_id=bot_name, thread_id=thread_id, text=summary_text)
                summaries.append(summary_text)
                logger.info("Chunk %d/%d summarized and embedded.", i+1, len(chunks))
            except Exception as e:
                logger.error("Failed to process chunk %d of thread %s: %s", i+1, thread_id, e)
                
        if not summaries:
            continue
            
        # Update checkpointer: prune old messages and write final rolling summary
        try:
            build_graph = get_agent(bot_name)
            if not build_graph:
                logger.error("Agent %s not found in registry. Skipping state compaction.", bot_name)
                continue
                
            graph = build_graph(llm).compile(checkpointer=cp)
            
            # Emit RemoveMessages for all old messages
            removals = [RemoveMessage(id=getattr(m, "id")) for m in messages if getattr(m, "id", None)]
            
            combined_summary = " ".join(summaries)
            new_summary_msg = SystemMessage(
                content=f"[Summary of previous conversation: {combined_summary}]"
            )
            
            # Direct update in checkpointer
            graph.update_state(config, {"messages": removals + [new_summary_msg]})
            logger.info("Thread %s history compacted in checkpointer.", thread_id)
            migrated_count += 1
        except Exception as e:
            logger.error("Failed to compact checkpointer state for thread %s: %s", thread_id, e)
            
    logger.info("Migration complete. Processed: %d, Migrated: %d", processed_count, migrated_count)

if __name__ == "__main__":
    run_migration()
