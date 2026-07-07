#!/usr/bin/env python3
"""Sync user messages with Vespera Nightwhisper in prod environment via REST APIs."""

import os
import sys
import time
import json
import argparse
import subprocess
import requests
import jwt

PROJECT_ID = "tavern-swiper-prod"
REGION = "us-central1"

# Hardcoded production values
VESPERA_PROFILE_ID = "ba534299-de3b-4cde-9e6b-a881dc4eaac9"
JWT_SECRET = "ofPjAHbf1C2otI/rpoA5SUjom0wd0qcNGlG0bv5G2sI="

def get_service_urls() -> dict:
    """Retrieve service URLs dynamically from the production Router service."""
    deploy_name = "router-prod"
    try:
        router_url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name,
            "--platform", "managed", "--region", REGION, "--project", PROJECT_ID,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()

        resp = requests.get(f"{router_url}/router/services", timeout=10)
        resp.raise_for_status()
        return resp.json().get("services", {})
    except Exception as e:
        print(f"❌ Failed to query router URL in prod: {e}")
        sys.exit(1)

def mint_token() -> str:
    """Generate a Tavern JWT bot token for authorization using the hardcoded JWT secret."""
    now = int(time.time())
    payload = {
        "sub": "vespera-bot-sync",
        "role": "root_admin",
        "email": "vespera-bot@tavernswiper.com",
        "iat": now,
        "exp": now + 3600  # 1 hour validity
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def parse_agent_response(raw_response: str) -> list:
    """Parse Vespera's JSON array response format."""
    trimmed = raw_response.strip()
    # Strip markdown fences if present
    if trimmed.startswith("```"):
        lines = trimmed.split("\n")
        if len(lines) >= 3:
            inner = lines[1:]
            for len_inner in range(len(inner)):
                if inner[len(inner) - 1 - len_inner].strip() == "```":
                    inner = inner[:len(inner) - 1 - len_inner]
                    break
            trimmed = "\n".join(inner).strip()

    try:
        items = json.loads(trimmed)
        if isinstance(items, list):
            return items
    except json.JSONDecodeError:
        pass

    return [{"type": "message", "content": raw_response}]

def run_sync():
    print("⚠️ WARNING: This command will modify the PRODUCTION environment.")
    confirm = input("Are you sure you want to run this in PRODUCTION? (yes/NO): ").strip().lower()
    if confirm != "yes":
        print("❌ Canceled.")
        sys.exit(0)

    # 1. Mint Tavern JWT
    token = mint_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # 2. Resolve Service URLs
    print("📡 Discovering production service URLs...")
    services = get_service_urls()
    
    profiles_url = services.get("profiles")
    messages_url = services.get("messages")
    agent_router_url = services.get("agent_router")

    if not all([profiles_url, messages_url, agent_router_url]):
        print(f"❌ Missing critical service URLs in resolved services: {services}")
        sys.exit(1)

    print(f"  - Profiles URL: {profiles_url}")
    print(f"  - Messages URL: {messages_url}")
    print(f"  - Agent Router URL: {agent_router_url}")
    print(f"  - Vespera Profile ID (Hardcoded): {VESPERA_PROFILE_ID}")

    # 3. Fetch conversations for Vespera
    print("\n📩 Fetching conversations...")
    resp = requests.get(f"{messages_url}/messages/conversations/profile/{VESPERA_PROFILE_ID}", headers=headers, timeout=10)
    resp.raise_for_status()
    conversations = resp.json()
    print(f"Found {len(conversations)} conversations involving Vespera.")

    active_syncs = 0
    for conv in conversations:
        conv_id = conv.get("id")
        participants = conv.get("participant_ids", [])
        last_msg = conv.get("last_message")

        if not last_msg:
            continue

        sender_id = last_msg.get("sender_profile_id")
        
        # If the last message was NOT sent by Vespera, we reply
        if sender_id and sender_id != VESPERA_PROFILE_ID:
            active_syncs += 1
            user_msg = last_msg.get("content", "")
            user_profile_id = next((p for p in participants if p != VESPERA_PROFILE_ID), "")
            
            print(f"\n📥 New message in conversation {conv_id} from {sender_id}:")
            print(f"   > \"{user_msg}\"")

            print("🧠 Querying agent_router...")
            try:
                router_resp = requests.post(
                    f"{agent_router_url}/invoke",
                    headers=headers,
                    json={
                        "prompt": user_msg,
                        "agent": "vespera",
                        "thread_id": conv_id,
                        "metadata": {
                          "sender_profile_id": user_profile_id,
                          "bot_profile_id": VESPERA_PROFILE_ID
                        }
                    },
                    timeout=50
                )

                if router_resp.status_code != 200:
                    print(f"❌ agent_router error (HTTP {router_resp.status_code}): {router_resp.text}")
                    continue

                raw_reply = router_resp.json().get("response", "")
                blocks = parse_agent_response(raw_reply)

                print("✍️ Posting replies to Messages API...")
                for block in blocks:
                    block_type = block.get("type", "message")
                    content = block.get("content", "")
                    
                    payload = {
                        "sender_profile_id": VESPERA_PROFILE_ID,
                        "content": content
                    }
                    
                    if block_type == "narration":
                        payload["type"] = "event"
                        payload["metadata"] = {
                            "event_type": "narration",
                            "initiated_by": VESPERA_PROFILE_ID
                        }

                    post_resp = requests.post(
                        f"{messages_url}/messages/conversations/{conv_id}/messages",
                        headers=headers,
                        json=payload,
                        timeout=10
                    )
                    post_resp.raise_for_status()
                    print(f"   + Posted {block_type}: \"{content}\"")

            except Exception as e:
                print(f"❌ Failed to process reply for conversation {conv_id}: {e}")

    if active_syncs == 0:
        print("\n😴 No pending user messages for Vespera.")
    else:
        print(f"\n✅ Completed sync. Replied to {active_syncs} conversations.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync user messages with Vespera in prod environment.")
    parser.add_argument("--env", default="prod", choices=["prod"], help="Target environment (forced to prod)")
    args = parser.parse_args()

    run_sync()
