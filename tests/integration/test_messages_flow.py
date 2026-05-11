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

        # Add a sleep to ensure the second message has a different RFC3339 timestamp string
        # This prevents stable sorting issues in the API response.
        await asyncio.sleep(1.1)

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

        # --- STEP 7: Idempotency Check ---
        print("\nStep 7: Idempotency Check")
        # Creating a conversation that already exists should return 200 instead of 201
        resp_idem = await client.post(
            f"{MESSAGES_URL}/messages/conversations", 
            json=init_payload, 
            headers={"Authorization": f"Bearer {hero_a['token']}"}
        )
        assert resp_idem.status_code == 200, f"Expected 200 for existing conversation, got {resp_idem.status_code}"
        assert resp_idem.json()["conversation_id"] == conv_id, "Returned conversation ID changed!"
        print(f"✅ Conversation idempotency verified")


@pytest.mark.asyncio
async def test_dice_roll_standalone():
    """
    Tests a simple dice roll without a conversation.
    No database interaction — just validates the roll endpoint returns a valid result.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Register a user (need a valid JWT)
        print("\n[PREP] Registering user for standalone dice roll...")
        user = await register_user(client)

        for dice_type in ["d4", "d6", "d8", "d12", "d20"]:
            resp = await client.post(
                f"{MESSAGES_URL}/messages/roll-dice",
                headers={"Authorization": f"Bearer {user['token']}"},
                json={"type": dice_type}
            )
            assert resp.status_code == 200, f"Dice roll failed for {dice_type}: {resp.text}"
            data = resp.json()
            assert data["type"] == dice_type
            max_val = int(dice_type[1:])
            assert 1 <= data["result"] <= max_val, f"{dice_type} roll out of range: {data['result']}"
            assert data.get("conversation_id", "") == "", "Should not have conversation_id"
            assert data.get("message_id", "") == "", "Should not have message_id"
            print(f"  ✅ {dice_type}: rolled {data['result']}")

        # Invalid dice type
        resp = await client.post(
            f"{MESSAGES_URL}/messages/roll-dice",
            headers={"Authorization": f"Bearer {user['token']}"},
            json={"type": "d100"}
        )
        assert resp.status_code == 422, f"Expected 422 for invalid dice, got {resp.status_code}"
        print("  ✅ Invalid dice type correctly rejected")

        print("✅ Standalone dice roll tests passed")


@pytest.mark.asyncio
async def test_dice_roll_in_conversation():
    """
    Tests rolling dice in a conversation:
    1. Creates two matched users with a conversation
    2. Hero A rolls a d20 in the conversation
    3. Verifies the event message appears in the conversation history
    4. Verifies the event message contains Hero A's display name
    5. Verifies non-participants cannot roll in the conversation
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        hero_a_name = f"Gandalf-{uuid.uuid4().hex[:4]}"
        hero_b_name = f"Aragorn-{uuid.uuid4().hex[:4]}"

        # --- SETUP: Two matched users with a conversation ---
        print(f"\n[PREP] Setting up matched pair: {hero_a_name} & {hero_b_name}")
        hero_a = await register_user(client)
        hero_a_pid = await create_profile(client, hero_a["token"], hero_a_name)

        hero_b = await register_user(client)
        hero_b_pid = await create_profile(client, hero_b["token"], hero_b_name)

        # Wait for profile cache propagation
        print("[PREP] Waiting for profile cache propagation...")
        await asyncio.sleep(5)

        # Create mutual match
        print("[PREP] Creating mutual match...")
        await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {hero_a['token']}"},
            json={"swiper_profile_id": hero_a_pid, "swiped_profile_id": hero_b_pid, "direction": "right"}
        )
        await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {hero_b['token']}"},
            json={"swiper_profile_id": hero_b_pid, "swiped_profile_id": hero_a_pid, "direction": "right"}
        )

        # Wait for match cache propagation
        print("[PREP] Waiting for match cache propagation...")
        found = await poll_for_match_cache([hero_a_pid, hero_b_pid])
        assert found, "Match NOT found in messages cache after timeout"

        # Create conversation
        print("[PREP] Creating conversation...")
        resp = await client.post(
            f"{MESSAGES_URL}/messages/conversations",
            headers={"Authorization": f"Bearer {hero_a['token']}"},
            json={"participant_profile_ids": [hero_a_pid, hero_b_pid]}
        )
        assert resp.status_code in [200, 201], f"Failed to create conversation: {resp.text}"
        conv_id = resp.json()["conversation_id"]
        print(f"  ✅ Conversation created: {conv_id}")

        # --- STEP 1: Hero A sends a regular message first ---
        print("\nStep 1: Hero A sends a regular message")
        resp = await client.post(
            f"{MESSAGES_URL}/messages/conversations/{conv_id}/messages",
            headers={"Authorization": f"Bearer {hero_a['token']}"},
            json={"sender_profile_id": hero_a_pid, "content": "Let us see what fate decrees!"}
        )
        assert resp.status_code == 201
        print("  ✅ Regular message sent")

        await asyncio.sleep(1.1)

        # --- STEP 2: Hero A rolls a d20 in the conversation ---
        print("\nStep 2: Hero A rolls a d20 in the conversation")
        resp = await client.post(
            f"{MESSAGES_URL}/messages/roll-dice",
            headers={"Authorization": f"Bearer {hero_a['token']}"},
            json={"type": "d20", "conversation_id": conv_id, "profile_id": hero_a_pid}
        )
        assert resp.status_code == 200, f"Dice roll in conversation failed: {resp.text}"
        roll_data = resp.json()
        assert roll_data["type"] == "d20"
        assert 1 <= roll_data["result"] <= 20
        assert roll_data["conversation_id"] == conv_id
        assert roll_data["message_id"] != "", "Expected a message_id from the dice roll"
        print(f"  ✅ Rolled a {roll_data['result']} on a d20 (message_id: {roll_data['message_id']})")

        await asyncio.sleep(1.1)

        # --- STEP 3: Verify the event message in conversation history ---
        print("\nStep 3: Verify event message in conversation history")
        resp = await client.get(
            f"{MESSAGES_URL}/messages/conversations/{conv_id}/messages",
            headers={"Authorization": f"Bearer {hero_a['token']}"}
        )
        assert resp.status_code == 200
        history = resp.json()

        # Should have 2 messages: the regular one + the dice roll event
        assert len(history) >= 2, f"Expected at least 2 messages, got {len(history)}"

        # Find the dice roll event message
        dice_msg = None
        for msg in history:
            if msg.get("type") == "event" and "rolled a" in msg.get("content", ""):
                dice_msg = msg
                break

        assert dice_msg is not None, f"Dice roll event message not found in history: {[m['content'] for m in history]}"
        assert hero_a_name in dice_msg["content"], (
            f"Expected display name '{hero_a_name}' in event message, got: '{dice_msg['content']}'"
        )
        assert f"d20" in dice_msg["content"], f"Expected 'd20' in event message: '{dice_msg['content']}'"
        assert str(roll_data["result"]) in dice_msg["content"], (
            f"Expected roll result '{roll_data['result']}' in event message: '{dice_msg['content']}'"
        )
        print(f"  ✅ Event message verified: \"{dice_msg['content']}\"")

        # --- STEP 4: Verify the dice roll updated the conversation's last_message ---
        print("\nStep 4: Verify conversation denormalization")
        resp = await client.get(
            f"{MESSAGES_URL}/messages/conversations/profile/{hero_a_pid}",
            headers={"Authorization": f"Bearer {hero_a['token']}"}
        )
        assert resp.status_code == 200
        inbox = resp.json()
        our_conv = next((c for c in inbox if c["id"] == conv_id), None)
        assert our_conv is not None, "Conversation not found in inbox"
        assert hero_a_name in our_conv["last_message"]["content"], (
            f"Last message should contain dice roll event, got: '{our_conv['last_message']['content']}'"
        )
        print(f"  ✅ Last message denormalization correct")

        # --- STEP 5: Non-participant cannot roll in this conversation ---
        print("\nStep 5: Non-participant blocked from rolling")
        outsider = await register_user(client)
        outsider_pid = await create_profile(client, outsider["token"], "Sauron")

        resp = await client.post(
            f"{MESSAGES_URL}/messages/roll-dice",
            headers={"Authorization": f"Bearer {outsider['token']}"},
            json={"type": "d6", "conversation_id": conv_id, "profile_id": outsider_pid}
        )
        assert resp.status_code == 403, f"Expected 403 for non-participant, got {resp.status_code}"
        print("  ✅ Non-participant correctly blocked from rolling")

        # --- STEP 6: Missing profile_id when conversation_id is set ---
        print("\nStep 6: Missing profile_id rejected")
        resp = await client.post(
            f"{MESSAGES_URL}/messages/roll-dice",
            headers={"Authorization": f"Bearer {hero_a['token']}"},
            json={"type": "d6", "conversation_id": conv_id}
        )
        assert resp.status_code == 422, f"Expected 422 for missing profile_id, got {resp.status_code}"
        print("  ✅ Missing profile_id correctly rejected")

        print("\n✅ All dice roll in conversation tests passed!")

