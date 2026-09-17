"""Integration Test: agent_router_worker memory processing & vector storage."""

import pytest
import httpx
import uuid
import asyncio
import os
from google.cloud import firestore

FIRESTORE_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
ENV = os.getenv("ENV", "dev")
ROUTER_DB = os.getenv("FIRESTORE_DATABASE_ID", f"agent-router-{ENV}")
WORKER_URL = os.getenv("AGENT_ROUTER_WORKER_URL", "http://localhost:8009")


@pytest.mark.asyncio
async def test_agent_router_worker_health():
    """Verify worker service health endpoint."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(f"{WORKER_URL}/health")
            assert resp.status_code == 200
            assert resp.json().get("service") == "agent_router_worker"
        except httpx.ConnectError:
            pytest.skip(f"Worker service at {WORKER_URL} is not running locally.")


@pytest.mark.asyncio
async def test_agent_router_worker_memory_event():
    """
    Integration Test: Send a memory event payload to agent_router_worker and verify Firestore agent_memories storage.
    """
    thread_id = f"test-worker-thread-{uuid.uuid4().hex[:8]}"
    agent_id = "lira"
    history_text = "Adventurer gave Lira a secret silver key to unlock the ancient chest in the tavern cellars."

    payload = {
        "thread_id": thread_id,
        "agent_id": agent_id,
        "history_text": history_text
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(f"{WORKER_URL}/process", json=payload)
            assert resp.status_code == 200
            data = resp.json()
            assert data.get("status") == "success"
            assert data.get("facts_stored", 0) > 0

            # Verify Firestore agent_memories collection
            db = firestore.Client(project=FIRESTORE_PROJECT, database=ROUTER_DB)
            docs = list(db.collection("agent_memories").where("thread_id", "==", thread_id).stream())
            assert len(docs) > 0, f"Expected agent_memories for thread {thread_id}"
            
            # Clean up test documents
            for doc in docs:
                doc.reference.delete()

        except httpx.ConnectError:
            pytest.skip(f"Worker service at {WORKER_URL} is not running locally.")
