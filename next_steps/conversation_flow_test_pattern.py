import requests
import json
import uuid
import time

"""
SUGGESTED PATTERN: Conversation Flow Integration Test
This script outlines the end-to-end flow for testing the decoupled messaging service.
It assumes the discovery-subscriber has already populated the match cache.
"""

BASE_URL = "https://messages-go-dev-xyz.a.run.app"  # Update with actual deployed URL
AUTH_TOKEN_A = "bearer-token-for-hero-1"
AUTH_TOKEN_B = "bearer-token-for-hero-2"

HERO_A_ID = "hero-1"
HERO_B_ID = "hero-2"

def test_full_conversation_lifecycle():
    headers_a = {"Authorization": f"Bearer {AUTH_TOKEN_A}", "Content-Type": "application/json"}
    headers_b = {"Authorization": f"Bearer {AUTH_TOKEN_B}", "Content-Type": "application/json"}

    print("Step 1: Initiate Conversation as Hero A")
    # This checks the match cache and creates/retrieves the unique conversation
    init_payload = {"participant_profile_ids": [HERO_A_ID, HERO_B_ID]}
    resp = requests.post(f"{BASE_URL}/messages/conversations", json=init_payload, headers=headers_a)
    assert resp.status_code in [200, 201], f"Failed to init: {resp.text}"
    
    conv_id = resp.json()["conversation_id"]
    print(f"✅ Conversation established: {conv_id}")

    print("\nStep 2: Hero A sends the first message")
    msg_payload = {
        "sender_profile_id": HERO_A_ID,
        "content": "Hail, fellow adventurer! Are we ready for the dungeon?"
    }
    resp = requests.post(f"{BASE_URL}/messages/conversations/{conv_id}/messages", json=msg_payload, headers=headers_a)
    assert resp.status_code == 201, f"Failed to send: {resp.text}"
    print(f"✅ Message sent by {HERO_A_ID}")

    print("\nStep 3: Hero B checks their inbox")
    # This verifies the ProfileConversation mapping and denormalization
    resp = requests.get(f"{BASE_URL}/messages/conversations/profile/{HERO_B_ID}", headers=headers_b)
    assert resp.status_code == 200
    inbox = resp.json()
    
    # Logic check: Our specific conversation should be top of the list
    found = False
    for conv in inbox:
        if conv["id"] == conv_id:
            assert conv["last_message"]["content"] == msg_payload["content"]
            assert conv["other_profile_id"] == HERO_A_ID
            found = True
            break
    assert found, "Conversation not found in Hero B's inbox"
    print(f"✅ Inbox correctly updated for {HERO_B_ID}")

    print("\nStep 4: Hero B replies")
    reply_payload = {
        "sender_profile_id": HERO_B_ID,
        "content": "Indeed! I have my axe sharpened."
    }
    requests.post(f"{BASE_URL}/messages/conversations/{conv_id}/messages", json=reply_payload, headers=headers_b)
    print(f"✅ Reply sent by {HERO_B_ID}")

    print("\nStep 5: Verify Full History")
    resp = requests.get(f"{BASE_URL}/messages/conversations/{conv_id}/messages", headers=headers_a)
    history = resp.json()
    assert len(history) >= 2
    assert history[0]["content"] == msg_payload["content"]
    assert history[1]["content"] == reply_payload["content"]
    print(f"✅ Message history integrity verified")

    print("\nStep 6: Edge Case - Block Unauthorized Sender")
    unauthorized_headers = {"Authorization": "Bearer token-for-hero-3"}
    theft_payload = {"sender_profile_id": "hero-3", "content": "I'm stealing your loot!"}
    resp = requests.post(f"{BASE_URL}/messages/conversations/{conv_id}/messages", json=theft_payload, headers=unauthorized_headers)
    assert resp.status_code == 403
    print(f"✅ Correctly blocked unauthorized sender")

if __name__ == "__main__":
    try:
        test_full_conversation_lifecycle()
        print("\n✨ ALL CONVERSATION FLOW TESTS PASSED ✨")
    except Exception as e:
        print(f"\n❌ TEST FAILED: {str(e)}")
