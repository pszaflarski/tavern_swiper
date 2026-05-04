import pytest
import httpx
import uuid
import asyncio
import os
from google.cloud import firestore
from .helpers import register_user, AUTH_URL, PROFILES_URL, DISCOVERY_URL, USERS_URL

# --- Configuration ---
AUTH_URL = os.getenv("AUTH_SERVICE_URL", "http://localhost:8001")
PROFILES_URL = os.getenv("PROFILES_URL", "http://localhost:8002")
DISCOVERY_URL = os.getenv("DISCOVERY_URL", "http://localhost:8003")
USERS_URL = os.getenv("USERS_URL", "http://localhost:8004")

# Targeting the test database
FIRESTORE_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
MESSAGES_DB = os.getenv("MESSAGES_DB", "messages-dev")

@pytest.fixture
async def create_profile(auth_client):
    """Factory fixture to create a profile for a user."""
    async def _create(token, name):
        resp = await auth_client.post(
            f"{PROFILES_URL}/profiles/",
            headers={"Authorization": f"Bearer {token}"},
            json={"display_name": name, "tagline": "Test Profile", "gender": "Other"}
        )
        assert resp.status_code == 201
        return resp.json()["profile_id"]
    return _create

@pytest.fixture
async def authenticated_user():
    """Fixture to register a new user and return their token and UID."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        return await register_user(client)

async def poll_for_match_cache(match_id, timeout=30):
    """Poll Firestore messages-test DB for the cached match."""
    db = firestore.Client(project=FIRESTORE_PROJECT, database=MESSAGES_DB)
    collection = "discovery_matches_cache"
    
    print(f"🔍 Polling {MESSAGES_DB}/{collection} for match {match_id}...")
    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        doc_ref = db.collection(collection).document(match_id)
        doc = doc_ref.get()
        if doc.exists:
            print(f"✅ Found match {match_id} in cache!")
            return doc.to_dict()
        await asyncio.sleep(2)
    return None

@pytest.mark.asyncio
async def test_match_cache_propagation():
    """
    Integration Test: Match Cache Propagation
    1. Create User A & Profile A
    2. Create User B & Profile B
    3. A swipes RIGHT on B
    4. B swipes RIGHT on A -> Match Created
    5. Verify Match is cached in Messages Service DB
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        # --- 1. Setup Users & Profiles ---
        users = []
        for i in range(2):
            u_data = await register_user(client)
            token = u_data["token"]
            
            # Create profile
            p_resp = await client.post(
                f"{PROFILES_URL}/profiles/",
                headers={"Authorization": f"Bearer {token}"},
                json={"display_name": f"User-{i}", "tagline": "Tester", "gender": "Other"}
            )
            assert p_resp.status_code == 201
            profile_id = p_resp.json()["profile_id"]
            users.append({"token": token, "profile_id": profile_id})

        user_a, user_b = users[0], users[1]
        print(f"Profiles Created: A={user_a['profile_id']}, B={user_b['profile_id']}")

        # Wait for profiles to propagate to Discovery cache
        print("[PREP] Waiting for profiles to propagate to Discovery cache...")
        await asyncio.sleep(5)

        # --- 2. Perform Swipes ---
        # A swipes right on B
        print(f"User A swipes RIGHT on B...")
        swipe_a = await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {user_a['token']}"},
            json={
                "swiper_profile_id": user_a["profile_id"],
                "swiped_profile_id": user_b["profile_id"],
                "direction": "right"
            }
        )
        assert swipe_a.status_code == 201
        assert swipe_a.json().get("match_id") is None # No match yet

        # B swipes right on A
        print(f"User B swipes RIGHT on A...")
        swipe_b = await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {user_b['token']}"},
            json={
                "swiper_profile_id": user_b["profile_id"],
                "swiped_profile_id": user_a["profile_id"],
                "direction": "right"
            }
        )
        assert swipe_b.status_code == 201
        match_id = swipe_b.json().get("match_id")
        assert match_id is not None
        print(f"🔥 Match Created! ID: {match_id}")

        # --- 3. Verify Cache Propagation ---
        print("Waiting for match to propagate to messages cache...")
        cached_match = await poll_for_match_cache(match_id)
        
        assert cached_match is not None, f"Match {match_id} was never cached in {MESSAGES_DB}"
        assert cached_match["match_id"] == match_id
        assert user_a["profile_id"] in cached_match["profile_ids"]
        assert user_b["profile_id"] in cached_match["profile_ids"]
        print("✅ Match Cache Propagation Verified!")
