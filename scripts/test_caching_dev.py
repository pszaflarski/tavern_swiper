import os
import sys
import time
import uuid
import json
import requests
import subprocess

PROJECT_ID = "tavern-swiper-dev"
REGION = "us-central1"


def run_cmd(args):
    """Run a shell command and return its trimmed stdout."""
    try:
        return subprocess.check_output(args, stderr=subprocess.DEVNULL).decode("utf-8").strip()
    except Exception as e:
        print(f"Error running command {args}: {e}")
        return None


def get_service_url(service_name):
    """Discover Cloud Run URL using gcloud."""
    print(f"🔍 Discovering URL for {service_name}-dev...")
    url = run_cmd([
        "gcloud", "run", "services", "describe", f"{service_name}-dev",
        "--platform", "managed", "--region", REGION, "--project", PROJECT_ID,
        "--format", "value(status.url)"
    ])
    return url


def get_gcloud_logs(service_name, thread_id):
    """Fetch logs from Cloud Logging filtering by service and thread_id."""
    print(f"\n📡 Fetching Cloud Run logs for {service_name}-dev and thread {thread_id}...")
    # Give Cloud Logging a few seconds to ingest logs
    time.sleep(12)
    
    query = (
        f"resource.type=cloud_run_revision AND "
        f"resource.labels.service_name={service_name}-dev AND "
        f"textPayload:\"{thread_id}\""
    )
    logs = run_cmd([
        "gcloud", "logging", "read", query,
        "--limit=50", "--project", PROJECT_ID, "--format=json"
    ])
    
    if not logs:
        print("  No logs found or gcloud logging failed.")
        return []
    
    try:
        log_entries = json.loads(logs)
        results = []
        for entry in log_entries:
            payload = entry.get("textPayload", "")
            results.append(payload)
        return results
    except Exception as e:
        print(f"  Failed to parse logs: {e}")
        return []


def main():
    # 1. Discover URLs
    auth_url = get_service_url("auth")
    agent_router_url = get_service_url("agent-router")
    profiles_url = get_service_url("profiles")
    
    if not auth_url or not agent_router_url or not profiles_url:
        print("❌ Failed to discover service URLs. Make sure you are authenticated with gcloud.")
        sys.exit(1)
        
    print(f"✅ Auth Service: {auth_url}")
    print(f"✅ Agent Router: {agent_router_url}")
    print(f"✅ Profiles URL: {profiles_url}")
    
    # 2. Get Tavern JWT
    print("\n🔐 Authenticating as user1@example.com (Valerius)...")
    try:
        login_resp = requests.post(f"{auth_url}/auth/login", json={
            "email": "user1@example.com",
            "password": "Password123!"
        })
        login_resp.raise_for_status()
        id_token = login_resp.json()["id_token"]
        
        verify_resp = requests.post(f"{auth_url}/auth/verify", json={"id_token": id_token})
        verify_resp.raise_for_status()
        token = verify_resp.json()["token"]
        print("✅ JWT Authenticated successfully.")
    except Exception as e:
        print(f"❌ Authentication failed: {e}")
        sys.exit(1)
        
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # 3. Initialize Thread ID
    thread_id = f"test-caching-dev-{uuid.uuid4().hex[:8]}"
    print(f"\n💬 Starting conversation thread: {thread_id}")
    
    # Large prompt to exceed 32k tokens: 140,000 characters is ~35,000 tokens
    large_context = "Adventure narrative detail " * 20000
    
    # Turn 1: Large prompt (prefix is under 32k, so no caching created yet)
    print("\n--- TURN 1: Sending first large message (to exceed 32k tokens total) ---")
    payload1 = {
        "prompt": f"This is our base backstory. {large_context[:130000]} End story. Remember this.",
        "agent": "example_chat",
        "model": "gemini-flash-lite",
        "thread_id": thread_id
    }
    
    t0 = time.time()
    resp1 = requests.post(f"{agent_router_url}/invoke", json=payload1, headers=headers)
    print(f"Status: {resp1.status_code} | Duration: {time.time() - t0:.2f}s")
    if resp1.status_code == 200:
        data = resp1.json()
        print(f"Model resolved: {data.get('model')}")
        print(f"Tokens consumed: {data.get('token_count')}")
        print(f"Reply summary: {data.get('response')[:100]}...")
        
    # Turn 2: Short prompt (prefix: Turn 1 contains > 32k, should create Cache Miss)
    print("\n--- TURN 2: Sending second message (should trigger Cache MISS & creation) ---")
    payload2 = {
        "prompt": "Hello Lira! Tell me a sarcastic joke.",
        "agent": "example_chat",
        "model": "gemini-flash-lite",
        "thread_id": thread_id
    }
    t0 = time.time()
    resp2 = requests.post(f"{agent_router_url}/invoke", json=payload2, headers=headers)
    print(f"Status: {resp2.status_code} | Duration: {time.time() - t0:.2f}s")
    if resp2.status_code == 200:
        data = resp2.json()
        print(f"Tokens consumed: {data.get('token_count')}")
        print(f"Reply: {data.get('response')}")

    # Turn 3: Short prompt (prefix: Turn 1-2 matches existing cache, should trigger Cache HIT)
    print("\n--- TURN 3: Sending third message (should trigger Cache HIT - faster/cheaper) ---")
    payload3 = {
        "prompt": "And what is the name of our backstory tavern?",
        "agent": "example_chat",
        "model": "gemini-flash-lite",
        "thread_id": thread_id
    }
    t0 = time.time()
    resp3 = requests.post(f"{agent_router_url}/invoke", json=payload3, headers=headers)
    print(f"Status: {resp3.status_code} | Duration: {time.time() - t0:.2f}s")
    if resp3.status_code == 200:
        data = resp3.json()
        print(f"Tokens consumed: {data.get('token_count')}")
        print(f"Reply: {data.get('response')}")

    # Turn 4: Large prompt to trigger Compaction (60,000 threshold)
    print("\n--- TURN 4: Sending another large message to exceed 60,000 tokens (triggers compaction) ---")
    payload4 = {
        "prompt": f"Add this massive detail to our lore. {large_context[:120000]} End of detail.",
        "agent": "example_chat",
        "model": "gemini-flash-lite",
        "thread_id": thread_id
    }
    t0 = time.time()
    resp4 = requests.post(f"{agent_router_url}/invoke", json=payload4, headers=headers)
    print(f"Status: {resp4.status_code} | Duration: {time.time() - t0:.2f}s")
    if resp4.status_code == 200:
        data = resp4.json()
        print(f"Tokens consumed: {data.get('token_count')}")
        print(f"Reply: {data.get('response')[:100]}...")

    # 4. Verify thread state pruning
    print("\n--- Checking thread state size (should be compacted to exactly 3 messages) ---")
    thread_resp = requests.get(f"{agent_router_url}/threads/{thread_id}", headers=headers)
    if thread_resp.status_code == 200:
        thread_data = thread_resp.json()
        messages = thread_data.get("messages", [])
        print(f"✅ Active messages in thread: {len(messages)}")
        for idx, msg in enumerate(messages):
            print(f"  {idx+1}. [{msg['type']}]: {msg['content'][:150]}...")
    else:
        print(f"❌ Failed to fetch thread state: {thread_resp.status_code} {thread_resp.text}")

    # 5. Retrieve logs to verify caching/compaction in logs
    log_lines = get_gcloud_logs("agent-router", thread_id)
    print(f"\n📋 Cache & Compaction Verification Logs ({len(log_lines)} entries):")
    # Filter log entries to show only relevant cache/compaction messages
    keywords = ["cache", "cache hit", "cache miss", "caching", "compact", "summarize", "invalidate"]
    filtered = []
    for line in log_lines:
        if any(kw in line.lower() for kw in keywords):
            filtered.append(line.strip())
            
    # Print in chronological order (logs are typically returned newest first, so reverse them)
    for line in reversed(filtered):
        print(f"  👉 {line}")


if __name__ == "__main__":
    main()
