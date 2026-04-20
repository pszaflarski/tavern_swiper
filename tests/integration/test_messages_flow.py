import pytest
import httpx
import asyncio
import os
import uuid
from .helpers import register_user, create_profile

# Configuration
MESSAGES_URL = os.getenv("MESSAGES_URL", "http://localhost:8005")
DISCOVERY_URL = os.getenv("DISCOVERY_URL", "http://localhost:8003")
MESSAGES_DB = os.getenv("MESSAGES_DB", "messages-dev")
FIRESTORE_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")

async def poll_for_match_cache(pids, timeout=30):
    """Wait for a match between these profile IDs to appear in the messages cache."""
    from google.cloud import firestore
    # We use a custom client to check the database directly
    db = firestore.Client(project=FIRESTORE_PROJECT, database=MESSAGES_DB)
    collection = "discovery_matches_cache"
    
    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        # The service queries for pids[0] and then filters for pids[1]
        docs = db.collection(collection).where("profile_ids", "array_contains", pids[0]).stream()
        for doc in docs:
            data = doc.to_dict()
            if pids[1] in data.get("profile_ids", []):
                return True
        await asyncio.sleep(2)
    return False

@pytest.mark.asyncio
async def test_full_conversation_lifecycle():
    """
    Port of next_steps/conversation_flow_test_pattern.py to pytest + httpx.
    Tests the end-to-end flow for the decoupled messaging service.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        # --- PREPARATION: Setup 2 Users and 2 Profiles ---
        print("\n[PREP] Registering Hero A...")
        hero_a = await register_user(client)
        hero_a_profile_id = await create_profile(client, hero_a["token"], "Hero A")
        
        print("[PREP] Registering Hero B...")
        hero_b = await register_user(client)
        hero_b_profile_id = await create_profile(client, hero_b["token"], "Hero B")
        
        print(f"[PREP] Established: A={hero_a_profile_id}, B={hero_b_profile_id}")

        # --- PREPARATION: Create a Match so they can talk ---
        # Wait for profiles to propagate to discovery cache (via Pub/Sub)
        print("[PREP] Waiting for profiles to propagate to Discovery cache...")
        await asyncio.sleep(5) 

        print("[PREP] Hero A swipes RIGHT on Hero B")
        await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {hero_a['token']}"},
            json={
                "swiper_profile_id": hero_a_profile_id,
                "swiped_profile_id": hero_b_profile_id,
                "direction": "right"
            }
        )
        
        print("[PREP] Hero B swipes RIGHT on Hero A (Mutual Match!)")
        await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {hero_b['token']}"},
            json={
                "swiper_profile_id": hero_b_profile_id,
                "swiped_profile_id": hero_a_profile_id,
                "direction": "right"
            }
        )

        # Wait for the match to be cached in the Messages service (via Messages Subscriber)
        print("[PREP] Waiting for match cache propagation to Messages service...")
        found = await poll_for_match_cache([hero_a_profile_id, hero_b_profile_id])
        assert found, "Match NOT found in messages cache after timeout"
        print(f"✅ Match cache propagation verified for {hero_a_profile_id} and {hero_b_profile_id}")

        # --- STEP 1: Initiate Conversation as Hero A ---
        print("\nStep 1: Initiate Conversation as Hero A")
        # This checks the match cache and creates/retrieves the unique conversation
        init_payload = {"participant_profile_ids": [hero_a_profile_id, hero_b_profile_id]}
        resp = await client.post(
            f"{MESSAGES_URL}/messages/conversations", 
            json=init_payload, 
            headers={"Authorization": f"Bearer {hero_a['token']}"}
        )
        assert resp.status_code in [200, 201], f"Failed to init: {resp.text}"
        
        conv_id = resp.json()["conversation_id"]
        print(f"✅ Conversation established: {conv_id}")

        # --- STEP 2: Hero A sends the first message ---
        print("\nStep 2: Hero A sends the first message")
        msg_content = "Hail, fellow adventurer! Are we ready for the dungeon?"
        msg_payload = {
            "sender_profile_id": hero_a_profile_id,
            "content": msg_content
        }
        resp = await client.post(
            f"{MESSAGES_URL}/messages/conversations/{conv_id}/messages", 
            json=msg_payload, 
            headers={"Authorization": f"Bearer {hero_a['token']}"}
        )
        assert resp.status_code == 201, f"Failed to send: {resp.text}"
        print(f"✅ Message sent by {hero_a_profile_id}")

        # --- STEP 3: Hero B checks their inbox ---
        print("\nStep 3: Hero B checks their inbox")
        # This verifies the ProfileConversation mapping and denormalization
        resp = await client.get(
            f"{MESSAGES_URL}/messages/conversations/profile/{hero_b_profile_id}", 
            headers={"Authorization": f"Bearer {hero_b['token']}"}
        )
        assert resp.status_code == 200
        inbox = resp.json()
        
        # Logic check: Our specific conversation should be top of the list
        found = False
        for conv in inbox:
            if conv["id"] == conv_id:
                assert conv["last_message"]["content"] == msg_content
                assert conv["other_profile_id"] == hero_a_profile_id
                found = True
                break
        assert found, "Conversation not found in Hero B's inbox"
        print(f"✅ Inbox correctly updated for {hero_b_profile_id}")

        # --- STEP 4: Hero B replies ---
        print("\nStep 4: Hero B replies")
        reply_content = "Indeed! I have my axe sharpened."
        reply_payload = {
            "sender_profile_id": hero_b_profile_id,
            "content": reply_content
        }
        resp = await client.post(
            f"{MESSAGES_URL}/messages/conversations/{conv_id}/messages", 
            json=reply_payload, 
            headers={"Authorization": f"Bearer {hero_b['token']}"}
        )
        assert resp.status_code == 201
        print(f"✅ Reply sent by {hero_b_profile_id}")

        # --- STEP 5: Verify Full History ---
        print("\nStep 5: Verify Full History")
        resp = await client.get(
            f"{MESSAGES_URL}/messages/conversations/{conv_id}/messages", 
            headers={"Authorization": f"Bearer {hero_a['token']}"}
        )
        assert resp.status_code == 200
        history = resp.json()
        assert len(history) >= 2
        assert history[0]["content"] == msg_content
        assert history[1]["content"] == reply_content
        print(f"✅ Message history integrity verified")

        # --- STEP 6: Edge Case - Block Unauthorized Sender ---
        print("\nStep 6: Edge Case - Block Unauthorized Sender")
        # Try sending as a random profile ID
        thief_profile_id = str(uuid.uuid4())
        theft_payload = {"sender_profile_id": thief_profile_id, "content": "I'm stealing your loot!"}
        
        # Even if we use a valid token for some other user, they shouldn't be able to post to this conv
        hero_c = await register_user(client)
        resp = await client.post(
            f"{MESSAGES_URL}/messages/conversations/{conv_id}/messages", 
            json=theft_payload, 
            headers={"Authorization": f"Bearer {hero_c['token']}"}
        )
        assert resp.status_code == 403
        print(f"✅ Correctly blocked unauthorized sender")
