import os
import sys
import time
import json
import requests
import subprocess

PROJECT_ID = "tavern-swiper-dev"
REGION = "us-central1"
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_service_url(service_name):
    """Discover Cloud Run URL using gcloud."""
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", f"{service_name}-dev",
            "--platform", "managed", "--region", REGION, "--project", PROJECT_ID,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
        return url
    except Exception as e:
        print(f"Error discovering URL for {service_name}: {e}")
        return None


def main():
    # 1. Discover service URLs
    auth_url = get_service_url("auth")
    agent_router_url = get_service_url("agent-router")
    profiles_url = get_service_url("profiles")
    discovery_url = get_service_url("discovery")
    messages_url = get_service_url("messages")
    bots_url = get_service_url("bots")
    
    if not all([auth_url, agent_router_url, profiles_url, discovery_url, messages_url, bots_url]):
        print("❌ Failed to discover one or more Cloud Run service URLs.")
        sys.exit(1)
        
    print(f"✅ Auth URL: {auth_url}")
    print(f"✅ Agent Router URL: {agent_router_url}")
    print(f"✅ Profiles URL: {profiles_url}")
    print(f"✅ Discovery URL: {discovery_url}")
    print(f"✅ Messages URL: {messages_url}")
    print(f"✅ Bots URL: {bots_url}")
    
    # 2. Authenticate as Root Admin
    print("\n🔐 Authenticating as Root Admin...")
    try:
        login_resp = requests.post(f"{auth_url}/auth/login", json={
            "email": "root@tavernswiper.com",
            "password": "Password123!"
        })
        login_resp.raise_for_status()
        id_token = login_resp.json()["id_token"]
        
        verify_resp = requests.post(f"{auth_url}/auth/verify", json={"id_token": id_token})
        verify_resp.raise_for_status()
        admin_token = verify_resp.json()["token"]
        print("✅ Authenticated admin token successfully.")
    except Exception as e:
        print(f"❌ Root Admin Authentication failed: {e}")
        sys.exit(1)
        
    admin_headers = {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json"
    }
    
    # 2a. Authenticate as Valerius (user1@example.com)
    print("\n🔐 Authenticating as Valerius (user1@example.com)...")
    try:
        valerius_login = requests.post(f"{auth_url}/auth/login", json={
            "email": "user1@example.com",
            "password": "Password123!"
        })
        valerius_login.raise_for_status()
        valerius_id_token = valerius_login.json()["id_token"]
        
        valerius_verify = requests.post(f"{auth_url}/auth/verify", json={"id_token": valerius_id_token})
        valerius_verify.raise_for_status()
        valerius_token = valerius_verify.json()["token"]
        print("✅ Authenticated Valerius successfully.")
    except Exception as e:
        print(f"❌ Valerius Authentication failed: {e}")
        sys.exit(1)
        
    valerius_headers = {
        "Authorization": f"Bearer {valerius_token}",
        "Content-Type": "application/json"
    }
    
    # 2b. Authenticate as Bot Lira
    print("\n🤖 Retrieving bot credentials...")
    try:
        bots_resp = requests.get(f"{bots_url}/bots/", headers=admin_headers)
        bots_resp.raise_for_status()
        bots = bots_resp.json()
        
        bot_id = None
        for b in bots:
            if b.get("slug") == "tavern-keeper-dev":
                bot_id = b["bot_id"]
                break
                
        if not bot_id:
            print("❌ Bot 'tavern-keeper-dev' not found in bots list.")
            sys.exit(1)
            
        print(f"  Found bot ID: {bot_id}")
        
        creds_resp = requests.post(f"{bots_url}/bots/{bot_id}/creds", headers=admin_headers)
        creds_resp.raise_for_status()
        creds = creds_resp.json()
        bot_email = creds["email"]
        bot_password = creds["password"]
        
        bot_login = requests.post(f"{auth_url}/auth/login", json={
            "email": bot_email,
            "password": bot_password
        })
        bot_login.raise_for_status()
        bot_id_token = bot_login.json()["id_token"]
        
        bot_verify = requests.post(f"{auth_url}/auth/verify", json={"id_token": bot_id_token})
        bot_verify.raise_for_status()
        bot_token = bot_verify.json()["token"]
        print("✅ Authenticated Bot successfully.")
    except Exception as e:
        print(f"❌ Bot Authentication failed: {e}")
        sys.exit(1)
        
    bot_headers = {
        "Authorization": f"Bearer {bot_token}",
        "Content-Type": "application/json"
    }
    
    # 3. Find profile IDs for Valerius and Lira
    print("\n🔍 Querying profiles to find Valerius and Lira...")
    try:
        p_resp = requests.get(f"{profiles_url}/profiles/all", headers=admin_headers)
        p_resp.raise_for_status()
        profiles = p_resp.json()
        
        valerius_id = None
        lira_id = None
        
        for p in profiles:
            name = p.get("display_name", "")
            if "Lira" in name:
                lira_id = p["profile_id"]
            elif "Valerius" in name:
                valerius_id = p["profile_id"]
                
        if not valerius_id or not lira_id:
            print(f"❌ Profiles not found. Valerius: {valerius_id}, Lira: {lira_id}")
            sys.exit(1)
            
        print(f"✅ Valerius Profile ID: {valerius_id}")
        print(f"✅ Lira Profile ID: {lira_id}")
    except Exception as e:
        print(f"❌ Failed to resolve profiles: {e}")
        sys.exit(1)
        
    # 4. Check if conversation already exists, or create one (requires mutual match)
    print("\n🤝 Ensuring Valerius and Lira are matched in Discovery...")
    try:
        # Swipe right Valerius -> Lira
        s1 = requests.post(
            f"{discovery_url}/discovery/swipe/",
            headers=valerius_headers,
            json={
                "swiper_profile_id": valerius_id,
                "swiped_profile_id": lira_id,
                "direction": "right"
            }
        )
        print(f"  Valerius -> Lira swipe: {s1.status_code}")
        # Swipe right Lira -> Valerius
        s2 = requests.post(
            f"{discovery_url}/discovery/swipe/",
            headers=bot_headers,
            json={
                "swiper_profile_id": lira_id,
                "swiped_profile_id": valerius_id,
                "direction": "right"
            }
        )
        print(f"  Lira -> Valerius swipe: {s2.status_code}")
        print("  Waiting 5s for match cache propagation...")
        time.sleep(5)
    except Exception as e:
        print(f"  ⚠️ Swipe check failed (might already be matched): {e}")

    print("\n💬 Creating or fetching conversation in Messages service...")
    try:
        conv_resp = requests.post(
            f"{messages_url}/messages/conversations",
            headers=admin_headers,
            json={"participant_profile_ids": [valerius_id, lira_id]}
        )
        conv_resp.raise_for_status()
        conv_id = conv_resp.json()["conversation_id"]
        print(f"✅ Conversation ID: {conv_id}")
    except Exception as e:
        print(f"❌ Failed to create/fetch conversation: {e}")
        sys.exit(1)
        
    # 5. Dialogue turns configuration
    large_context = "Adventure narrative detail " * 20000
    
    turns = [
        {
            "prompt": f"This is our base backstory. {large_context[:130000]} End story. Remember this.",
            "description": "Large Backstory prompt (Turn 1)"
        },
        {
            "prompt": "Hello Lira! Tell me a sarcastic joke.",
            "description": "Joke prompt (Turn 2)"
        },
        {
            "prompt": "And what is the name of our backstory tavern?",
            "description": "Tavern question prompt (Turn 3)"
        },
        {
            "prompt": f"Add this massive detail to our lore. {large_context[:120000]} End of detail.",
            "description": "Large lore expansion (Turn 4)"
        }
    ]
    
    # 6. Execute dialogue loop
    print(f"\n🚀 Running {len(turns)} dialogue turns...")
    for idx, turn in enumerate(turns):
        print(f"\n--- {turn['description']} ---")
        prompt = turn["prompt"]
        
        # A. Send message as Valerius to messages DB
        print(f"  Valerius sending message...")
        send_user_resp = requests.post(
            f"{messages_url}/messages/conversations/{conv_id}/messages",
            headers=admin_headers,
            json={
                "sender_profile_id": valerius_id,
                "content": prompt[:1900] + "..." if len(prompt) > 1900 else prompt,
                "type": "user"
            }
        )
        if send_user_resp.status_code != 201:
            print(f"    ❌ Failed to send user message: {send_user_resp.status_code} {send_user_resp.text}")
            
        # B. Call agent_router example_chat to generate reply
        print(f"  Invoking example_chat from agent-router...")
        router_payload = {
            "prompt": prompt,
            "agent": "example_chat",
            "model": "gemini-flash-lite",
            "thread_id": conv_id  # Using conv_id as the thread_id
        }
        t0 = time.time()
        router_resp = requests.post(
            f"{agent_router_url}/invoke",
            json=router_payload,
            headers=admin_headers
        )
        print(f"    Router response status: {router_resp.status_code} | Duration: {time.time() - t0:.2f}s")
        
        if router_resp.status_code == 200:
            router_data = router_resp.json()
            lira_reply = router_data.get("response", "")
            print(f"    Tokens: {router_data.get('token_count')}")
            print(f"    Lira reply: {lira_reply[:150]}...")
            
            # C. Send message as Lira to messages DB
            print(f"  Writing Lira reply to messages DB...")
            send_bot_resp = requests.post(
                f"{messages_url}/messages/conversations/{conv_id}/messages",
                headers=admin_headers,
                json={
                    "sender_profile_id": lira_id,
                    "content": lira_reply,
                    "type": "user"
                }
            )
            if send_bot_resp.status_code != 201:
                print(f"    ❌ Failed to write bot reply: {send_bot_resp.status_code} {send_bot_resp.text}")
        else:
            print(f"    ❌ Router invocation failed: {router_resp.text}")
            
    # 7. Export full conversation from messages DB to dialogue.md
    print("\n📥 Exporting conversation from Messages DB...")
    msgs_resp = requests.get(
        f"{messages_url}/messages/conversations/{conv_id}/messages?profile_id={valerius_id}",
        headers=admin_headers
    )
    
    if msgs_resp.status_code == 200:
        msgs_data = msgs_resp.json()
        # The messages endpoint returns paginated envelope or bare array depending on query.
        # Since we did not pass limit, it returns a bare array of messages sorted by created_at.
        messages = msgs_data if isinstance(msgs_data, list) else msgs_data.get("messages", [])
        
        md_content = f"# Dialogue Log: Valerius & Lira\n\n"
        md_content += f"* **Environment**: Dev\n"
        md_content += f"* **Conversation ID**: `{conv_id}`\n"
        md_content += f"* **Seeded Messages**: {len(messages)}\n\n"
        md_content += f"---\n\n"
        
        for msg in messages:
            sender = "Valerius (Human)" if msg.get("sender_profile_id") == valerius_id else "Lira (AI)"
            if msg.get("type") == "system":
                sender = "System"
            content = msg.get("content", "").replace("\n", "\n> ")
            md_content += f"### 👤 {sender}\n"
            md_content += f"> {content}\n\n"
            
        dialogue_file = os.path.join(PROJECT_ROOT, "dialogue.md")
        with open(dialogue_file, "w", encoding="utf-8") as out:
            out.write(md_content)
            
        print(f"🎉 Conversation successfully exported to [dialogue.md](file://{dialogue_file})!")
    else:
        print(f"❌ Failed to fetch messages: {msgs_resp.status_code} {msgs_resp.text}")


if __name__ == "__main__":
    main()
