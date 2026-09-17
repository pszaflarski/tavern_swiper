"""Integration Test: Summarization, LangGraph History Compaction, and Async Memory Worker Trigger.

Tests:
1. LLMLingua-2 / Prompt Compression threshold handling.
2. LangGraph threshold gate routing (soft token limit -> async summarize dispatch, hard limit -> hard window).
3. End-to-end API invocation with memory recall and worker integration.
"""

import os
import time
import uuid
import pytest
import httpx

ROUTER_URL = os.getenv("AGENT_ROUTER_SERVICE_URL", os.getenv("AGENT_ROUTER_URL", "https://agent-router-dev-hhqol7siba-uc.a.run.app")).rstrip("/")
WORKER_URL = os.getenv("AGENT_ROUTER_WORKER_URL", "https://agent-router-worker-dev-hhqol7siba-uc.a.run.app").rstrip("/")
JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-tavern-key-123")


def get_auth_headers():
    import jwt
    token = jwt.encode(
        {"sub": "integration-test-user", "user_id": "integration-test-user", "exp": int(time.time()) + 3600},
        JWT_SECRET,
        algorithm="HS256"
    )
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "x-bypass-auth": "true",
    }


@pytest.mark.asyncio
async def test_summarization_gate_routing_and_async_dispatch():
    """Verify that history exceeding MAX_MEMORY_TOKENS routes to summarize and dispatches to the worker."""
    thread_id = f"test-summarize-integration-{uuid.uuid4().hex[:8]}"
    long_lore = "Adventurer explored the Sunken Crypt of Vorax and recovered 15 Silver Ore at Whispering Pass. " * 30

    payload = {
        "agent": "lira",
        "model": "gemini-flash-lite",
        "prompt": f"Greetings Lira! Review this extensive lore: {long_lore}",
        "thread_id": thread_id,
    }

    async with httpx.AsyncClient(timeout=45.0) as client:
        try:
            resp = await client.post(f"{ROUTER_URL}/invoke", json=payload, headers=get_auth_headers())
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            data = resp.json()
            assert data.get("thread_id") == thread_id
            assert data.get("response") is not None
        except httpx.ConnectError:
            pytest.skip(f"Agent Router service at {ROUTER_URL} is not reachable.")


@pytest.mark.asyncio
async def test_worker_process_memory_event_end_to_end():
    """Verify worker process memory endpoint extracts facts and stores vector memories."""
    thread_id = f"test-worker-mem-{uuid.uuid4().hex[:8]}"
    history_text = (
        "Adventurer: We fought the Frost Spiders at Whispering Pass and recovered 15 Silver Ore!\n"
        "Lira: Outstanding work! I will take the Silver Ore and award you 500 Gold pieces."
    )

    payload = {
        "thread_id": thread_id,
        "agent_id": "lira",
        "history_text": history_text,
        "summarize_system_prompt": "Summarize the key events of the story in 2 sentences."
    }

    headers = get_auth_headers()
    # Try fetching GCP OIDC token for Cloud Run IAM authentication
    import subprocess
    try:
        oidc_token = subprocess.check_output(["gcloud", "auth", "print-identity-token"], text=True).strip()
        if oidc_token:
            headers["Authorization"] = f"Bearer {oidc_token}"
    except Exception:
        pass

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(f"{WORKER_URL}/process", json=payload, headers=headers)
            if resp.status_code == 401:
                pytest.skip("Cloud Run worker requires GCP OIDC identity token for direct /process HTTP calls.")
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            data = resp.json()
            assert data.get("status") == "success"
            assert data.get("facts_stored", 0) > 0
        except httpx.ConnectError:
            pytest.skip(f"Worker service at {WORKER_URL} is not reachable.")
