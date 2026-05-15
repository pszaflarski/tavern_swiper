import pytest
import httpx
import uuid
import asyncio
import os
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from .helpers import get_root_admin, register_user, BOTS_URL, PROFILES_URL

# --- Configuration ---
FIRESTORE_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
BOTS_DB = os.getenv("BOTS_DB", "bots-dev")
DISCOVERY_DB = os.getenv("DISCOVERY_DB", "discovery-dev")


@pytest.fixture(scope="module")
async def admin_context():
    """Fixture: root admin token."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        return await get_root_admin(client)


@pytest.fixture(scope="module")
async def tavern_keeper(admin_context):
    """
    Fixture: register a tavern keeper bot and create a profile with behavior_type=tavern_keeper.
    Returns the bot_id, profile_id, and bot_profile_id.
    """
    headers = {"Authorization": f"Bearer {admin_context['token']}"}
    slug = f"inttest-keeper-{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Register bot
        reg_resp = await client.post(
            f"{BOTS_URL}/bots/",
            headers=headers,
            json={"slug": slug, "display_name": "Test Tavern Keeper"}
        )
        assert reg_resp.status_code == 201, f"Bot registration failed: {reg_resp.text}"
        bot_id = reg_resp.json()["bot_id"]

        # 2. Create profile with tavern_keeper behavior
        prof_resp = await client.post(
            f"{BOTS_URL}/bots/{bot_id}/profile",
            headers=headers,
            json={
                "display_name": f"Keeper-{slug}",
                "tagline": "Welcome to the tavern!",
                "bio": "I greet everyone who walks in.",
                "behavior_type": "tavern_keeper",
                "agent_name": f"keeper-{slug}",
                "gender": [],
                "race": [],
                "fandom": [],
                "interests": []
            }
        )
        assert prof_resp.status_code == 201, f"Bot profile creation failed: {prof_resp.text}"
        resp_data = prof_resp.json()
        profile_id = resp_data["profile_id"]
        bot_profile_id = resp_data["bot_profile_id"]

        print(f"\n🏨 Tavern keeper ready: bot={bot_id}, profile={profile_id}, bot_profile={bot_profile_id}")
        return {
            "bot_id": bot_id,
            "profile_id": profile_id,
            "bot_profile_id": bot_profile_id,
            "slug": slug,
        }


async def poll_for_swipe(swiper_profile_id: str, swiped_profile_id: str, timeout: int = 30) -> dict | None:
    """
    Poll the discovery DB's swipes collection for a swipe from the bot
    profile onto the target profile.
    """
    db = firestore.Client(project=FIRESTORE_PROJECT, database=DISCOVERY_DB)
    start = asyncio.get_event_loop().time()

    while (asyncio.get_event_loop().time() - start) < timeout:
        docs = db.collection("swipes").where(
            filter=FieldFilter("swiper_profile_id", "==", swiper_profile_id)
        ).where(
            filter=FieldFilter("swiped_profile_id", "==", swiped_profile_id)
        ).stream()

        for doc in docs:
            return doc.to_dict()

        await asyncio.sleep(2)

    return None


@pytest.mark.asyncio
async def test_tavern_keeper_swipes_on_new_profile(admin_context, tavern_keeper):
    """
    Integration Test: Tavern keeper auto-swipes right on a newly created profile.

    End-to-end flow:
    1. A tavern keeper bot profile already exists (via fixture)
    2. A regular user creates a profile
    3. The profiles service publishes a ProfileEvent (UPSERTED) to Pub/Sub
    4. bots_subscriber receives it → POSTs to bots_go /behaviors/trigger
    5. bots_go runs behaviorTavernKeeperSwipe:
       a. Checks target is not a bot (passes)
       b. Queries tavern keepers
       c. Authenticates as the bot user
       d. Calls discovery service POST /discovery/swipe/ with direction=right
    6. We poll the discovery DB for the swipe record
    """
    # 1. Create a regular user and profile
    async with httpx.AsyncClient(timeout=30.0) as client:
        user = await register_user(client)
        user_headers = {"Authorization": f"Bearer {user['token']}"}

        display_name = f"TavernGuest-{uuid.uuid4().hex[:6]}"
        print(f"\n👤 Creating user profile: {display_name}")

        create_resp = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=user_headers,
            json={"display_name": display_name, "tagline": "Just walked in", "gender": []}
        )
        assert create_resp.status_code == 201, f"Profile creation failed: {create_resp.text}"
        user_profile_id = create_resp.json()["profile_id"]
        print(f"   Profile created: {user_profile_id}")

        # 2. Poll for the tavern keeper's swipe on this profile
        keeper_profile_id = tavern_keeper["profile_id"]
        print(f"⏳ Waiting for swipe: {keeper_profile_id} → {user_profile_id} ...")

        swipe = await poll_for_swipe(keeper_profile_id, user_profile_id, timeout=30)

        assert swipe is not None, (
            f"No swipe found from tavern keeper {keeper_profile_id} "
            f"on user profile {user_profile_id} within 30s. "
            "Check bots_subscriber logs and bots_go behavior trigger logs."
        )
        assert swipe["direction"] == "right", f"Expected direction=right, got {swipe['direction']}"
        print(f"✅ Tavern keeper swiped right! swipe_id={swipe.get('swipe_id', 'N/A')}")

        # Cleanup
        await client.delete(f"{PROFILES_URL}/profiles/{user_profile_id}", headers=user_headers)
