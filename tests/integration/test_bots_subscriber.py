import pytest
import httpx
import uuid
import asyncio
import os
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from .helpers import register_user, PROFILES_URL, BOTS_URL

# --- Configuration ---
FIRESTORE_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
BOTS_DB = os.getenv("BOTS_DB", "bots-dev")


@pytest.fixture(scope="module")
async def auth_user():
    """Fixture to register a new user and return their token/UID."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        return await register_user(client)


async def poll_for_bot_event(trigger, profile_id, timeout=15):
    """
    Poll the bot_events collection in the bots DB for a record matching
    the given trigger and profile_id in its context, and has status "processed".
    """
    db = firestore.Client(project=FIRESTORE_PROJECT, database=BOTS_DB)
    collection = "bot_events"

    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        docs = db.collection(collection).where(
            filter=FieldFilter("trigger", "==", trigger)
        ).stream()
        for doc in docs:
            data = doc.to_dict()
            ctx = data.get("context", {})
            if ctx.get("profile_id") == profile_id and data.get("status") == "processed":
                return data
        await asyncio.sleep(1)
    return None


@pytest.mark.asyncio
async def test_profile_create_triggers_bot_event(auth_user):
    """
    Integration Test: Profile creation triggers a bot_events record.
    
    Flow:
    1. Create a profile via the Profiles API
    2. The profiles service publishes a ProfileEvent (UPSERTED) to Pub/Sub
    3. The bots_subscriber receives it and POSTs to bots_go /behaviors/trigger
    4. bots_go records it in the bot_events Firestore collection
    5. We poll that collection and verify the event arrived
    """
    headers = {"Authorization": f"Bearer {auth_user['token']}"}
    display_name = f"BotEventTest-{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Create a profile
        print(f"\nCreating profile: {display_name}")
        create_resp = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=headers,
            json={"display_name": display_name, "tagline": "Bot event test", "gender": []}
        )
        assert create_resp.status_code == 201, f"Profile creation failed: {create_resp.text}"
        profile_id = create_resp.json()["profile_id"]
        print(f"Profile created: {profile_id}")

        # 2. Poll for the bot_event record
        print(f"Waiting for bot_event with trigger=profile_created, profile_id={profile_id}...")
        event = await poll_for_bot_event("profile_created", profile_id)

        assert event is not None, (
            f"No bot_event found for profile {profile_id} within timeout. "
            "Check that bots_subscriber is running and forwarding events to bots_go."
        )
        assert event["trigger"] == "profile_created"
        assert event["status"] == "processed"
        assert event["context"]["profile_id"] == profile_id
        print(f"✅ Bot event received and processed: {event['event_id'][:16]}...")

        # Cleanup
        await client.delete(f"{PROFILES_URL}/profiles/{profile_id}", headers=headers)


@pytest.mark.asyncio
async def test_profile_delete_triggers_bot_event(auth_user):
    """
    Integration Test: Profile deletion triggers a bot_events record.
    
    Flow:
    1. Create a profile
    2. Delete it
    3. Verify a bot_event with trigger=profile_deleted appears
    """
    headers = {"Authorization": f"Bearer {auth_user['token']}"}
    display_name = f"BotDelTest-{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Create a profile
        create_resp = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=headers,
            json={"display_name": display_name, "tagline": "Delete test", "gender": []}
        )
        assert create_resp.status_code == 201
        profile_id = create_resp.json()["profile_id"]
        print(f"\nCreated profile {profile_id}, now deleting...")

        # 2. Wait for the create event to propagate first
        create_event = await poll_for_bot_event("profile_created", profile_id)
        assert create_event is not None, "Create event never arrived"

        # 3. Delete the profile
        del_resp = await client.delete(f"{PROFILES_URL}/profiles/{profile_id}", headers=headers)
        assert del_resp.status_code == 204

        # 4. Poll for the delete event
        print(f"Waiting for bot_event with trigger=profile_deleted, profile_id={profile_id}...")
        delete_event = await poll_for_bot_event("profile_deleted", profile_id)

        assert delete_event is not None, (
            f"No bot_event found for profile_deleted {profile_id} within timeout."
        )
        assert delete_event["trigger"] == "profile_deleted"
        assert delete_event["status"] == "processed"
        print(f"✅ Delete bot event received: {delete_event['event_id'][:16]}...")
