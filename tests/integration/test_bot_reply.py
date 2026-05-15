"""
Integration Test: Bot Reply Pipeline

Verifies the full message-received → bot-reply flow:
1. Register a bot with agent_name = "dummy_agent" (echo agent, no LLM needed)
2. Create a regular user with a profile
3. Both swipe right on each other → mutual match
4. Create a conversation between the two profiles
5. User sends a message
6. The messages service publishes a MessageEvent via Pub/Sub
7. bots_subscriber receives it → POSTs to bots_go /behaviors/trigger
8. bots_go authenticates as the bot, calls agent_router /invoke
9. agent_router runs the dummy_agent (echoes the message back)
10. bots_go posts the echo reply to the conversation
11. We poll the conversation for the bot's reply message
"""

import pytest
import httpx
import uuid
import asyncio
import os
from google.cloud import firestore
from .helpers import (
    get_root_admin, register_user,
    BOTS_URL, PROFILES_URL, DISCOVERY_URL, MESSAGES_URL, QUESTS_URL,
)

# --- Configuration ---
FIRESTORE_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
MESSAGES_DB = os.getenv("MESSAGES_DB", "messages-dev")


@pytest.fixture(scope="module")
async def admin_context():
    """Fixture: root admin token."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        return await get_root_admin(client)


@pytest.fixture(scope="module")
async def bot_with_dummy_agent(admin_context):
    """
    Fixture: register a bot user and create a profile with agent_name=dummy_agent.
    The dummy_agent echoes back whatever message it receives — no LLM required.
    """
    headers = {"Authorization": f"Bearer {admin_context['token']}"}
    slug = f"replybot-{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Register bot
        reg_resp = await client.post(
            f"{BOTS_URL}/bots/",
            headers=headers,
            json={"slug": slug, "display_name": "Echo Bot"}
        )
        assert reg_resp.status_code == 201, f"Bot registration failed: {reg_resp.text}"
        bot_data = reg_resp.json()
        bot_id = bot_data["bot_id"]
        bot_firebase_uid = bot_data["firebase_uid"]

        # 2. Create profile with dummy_agent behavior
        prof_resp = await client.post(
            f"{BOTS_URL}/bots/{bot_id}/profile",
            headers=headers,
            json={
                "display_name": f"EchoBot-{slug}",
                "tagline": "I echo everything you say!",
                "bio": "A test bot that echoes messages.",
                "behavior_type": "tavern_keeper",
                "agent_name": "dummy_agent",
                "gender": [],
                "race": [],
                "fandom": [],
                "interests": [],
            }
        )
        assert prof_resp.status_code == 201, f"Bot profile creation failed: {prof_resp.text}"
        resp_data = prof_resp.json()
        profile_id = resp_data["profile_id"]

        print(f"\n🤖 Echo bot ready: bot={bot_id}, profile={profile_id}")
        return {
            "bot_id": bot_id,
            "profile_id": profile_id,
            "firebase_uid": bot_firebase_uid,
            "slug": slug,
        }


async def poll_for_bot_reply(
    admin_token: str,
    conversation_id: str,
    bot_profile_id: str,
    timeout: int = 45,
) -> dict | None:
    """
    Poll the messages API for a reply message from the bot profile in the
    given conversation. Returns the first message sent by the bot, or None
    if no reply arrives within the timeout.
    """
    start = asyncio.get_event_loop().time()

    async with httpx.AsyncClient(timeout=15.0) as client:
        while (asyncio.get_event_loop().time() - start) < timeout:
            resp = await client.get(
                f"{MESSAGES_URL}/messages/conversations/{conversation_id}/messages",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            if resp.status_code == 200:
                messages = resp.json()
                for msg in messages:
                    if msg.get("sender_profile_id") == bot_profile_id:
                        return msg
            await asyncio.sleep(3)

    return None

async def poll_for_quest_completion(
    user_token: str,
    user_id: str,
    quest_id: str,
    timeout: int = 15,
) -> dict | None:
    """
    Poll the quests API for a completed status for the given quest.
    """
    start = asyncio.get_event_loop().time()

    async with httpx.AsyncClient(timeout=15.0) as client:
        while (asyncio.get_event_loop().time() - start) < timeout:
            resp = await client.get(
                f"{QUESTS_URL}/quests/status/{user_id}",
                headers={"Authorization": f"Bearer {user_token}"},
            )
            if resp.status_code == 200:
                statuses = resp.json()
                for qs in statuses:
                    if qs.get("quest_id") == quest_id and qs.get("status") == "completed":
                        return qs
            await asyncio.sleep(2)

    return None

@pytest.mark.asyncio
async def test_bot_replies_to_message(admin_context, bot_with_dummy_agent):
    """
    Integration Test: Bot replies to a user message via the full Pub/Sub pipeline.

    End-to-end flow:
    1. A bot with agent_name=dummy_agent exists (via fixture)
    2. A regular user creates a profile
    3. Both swipe right on each other → mutual match
    4. A conversation is created between them
    5. The user sends a message
    6. Pub/Sub pipeline triggers bot reply (message_received event)
    7. bots_go calls agent_router /invoke with the dummy_agent
    8. dummy_agent echoes the message back
    9. bots_go posts the reply to the conversation
    10. We poll the conversation and verify the bot replied
    """
    admin_token = admin_context["token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    bot_profile_id = bot_with_dummy_agent["profile_id"]

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Create a regular user and profile
        user = await register_user(client)
        user_headers = {"Authorization": f"Bearer {user['token']}"}

        display_name = f"ReplyTestHero-{uuid.uuid4().hex[:6]}"
        print(f"\n👤 Creating user profile: {display_name}")

        create_resp = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=user_headers,
            json={"display_name": display_name, "tagline": "Testing bot replies", "gender": []}
        )
        assert create_resp.status_code == 201, f"Profile creation failed: {create_resp.text}"
        user_profile_id = create_resp.json()["profile_id"]
        print(f"   Profile created: {user_profile_id}")

        # 2. Mutual swipe to create a match
        # The tavern keeper behavior should auto-swipe on profile_created,
        # but we also swipe explicitly to guarantee a match exists.
        print(f"🔄 Creating mutual match: {user_profile_id} ↔ {bot_profile_id}")

        # User swipes right on bot
        swipe_user = await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers=user_headers,
            json={
                "swiper_profile_id": user_profile_id,
                "swiped_profile_id": bot_profile_id,
                "direction": "right",
            }
        )
        print(f"   User swipe: {swipe_user.status_code}")

        # Wait for the tavern keeper auto-swipe to process
        # (the bot swipes right on new profiles via the profile_created event)
        await asyncio.sleep(5)

        # Bot swipes right on user (may already be done by tavern_keeper behavior)
        # Get bot credentials and login as bot to swipe
        creds_resp = await client.post(
            f"{BOTS_URL}/bots/{bot_with_dummy_agent['bot_id']}/creds",
            headers=admin_headers,
        )
        assert creds_resp.status_code == 200, f"Failed to get bot creds: {creds_resp.text}"
        creds = creds_resp.json()

        # Login as bot
        from .helpers import AUTH_URL
        login_resp = await client.post(
            f"{AUTH_URL}/auth/login",
            json={"email": creds["email"], "password": creds["password"]}
        )
        assert login_resp.status_code == 200, f"Bot login failed: {login_resp.text}"
        bot_id_token = login_resp.json()["id_token"]

        verify_resp = await client.post(
            f"{AUTH_URL}/auth/verify",
            json={"id_token": bot_id_token}
        )
        assert verify_resp.status_code == 200, f"Bot verify failed: {verify_resp.text}"
        bot_token = verify_resp.json()["token"]
        bot_headers = {"Authorization": f"Bearer {bot_token}"}

        swipe_bot = await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers=bot_headers,
            json={
                "swiper_profile_id": bot_profile_id,
                "swiped_profile_id": user_profile_id,
                "direction": "right",
            }
        )
        print(f"   Bot swipe: {swipe_bot.status_code}")

        # Wait for match event to propagate to messages service cache
        await asyncio.sleep(5)

        # 3. Create a conversation
        print(f"💬 Creating conversation between {user_profile_id} and {bot_profile_id}")
        conv_resp = await client.post(
            f"{MESSAGES_URL}/messages/conversations",
            headers=user_headers,
            json={"participant_profile_ids": [user_profile_id, bot_profile_id]}
        )
        assert conv_resp.status_code in [200, 201], f"Conversation creation failed: {conv_resp.text}"
        conversation_id = conv_resp.json()["conversation_id"]
        print(f"   Conversation: {conversation_id}")

        # 4. User sends a message
        test_message = f"Hello bot! Echo test {uuid.uuid4().hex[:8]}"
        print(f"📤 Sending message: '{test_message}'")

        msg_resp = await client.post(
            f"{MESSAGES_URL}/messages/conversations/{conversation_id}/messages",
            headers=user_headers,
            json={
                "sender_profile_id": user_profile_id,
                "content": test_message,
            }
        )
        assert msg_resp.status_code == 201, f"Message send failed: {msg_resp.text}"
        print(f"   Message sent: {msg_resp.json()['message_id']}")

        # 5. Poll for the bot's reply
        print(f"⏳ Waiting for bot reply in conversation {conversation_id}...")
        reply = await poll_for_bot_reply(
            admin_token, conversation_id, bot_profile_id, timeout=45
        )

        assert reply is not None, (
            f"No reply from bot {bot_profile_id} in conversation {conversation_id} "
            "within 45s. Check:\n"
            "  - messages_subscriber is running and forwarding message events\n"
            "  - bots_subscriber is receiving message_received triggers\n"
            "  - bots_go can reach agent_router\n"
            "  - agent_router has dummy_agent registered"
        )

        print(f"✅ Bot replied! Content: '{reply['content']}'")

        assert reply["content"] == test_message, (
            f"Expected echo of '{test_message}', got '{reply['content']}'"
        )
        assert reply["sender_profile_id"] == bot_profile_id
        print(f"✅ Echo content verified — bot reply pipeline works end-to-end!")

        # 11. Verify the 'meet_the_barkeep' quest was completed
        print(f"⏳ Waiting for 'meet_the_barkeep' quest completion for user {user['uid']}...")
        quest_status = await poll_for_quest_completion(
            user['token'], user['uid'], "meet_the_barkeep", timeout=15
        )
        assert quest_status is not None, "meet_the_barkeep quest was not completed within timeout."
        print(f"✅ Quest completion verified!")
