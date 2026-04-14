import pytest
import httpx
import uuid
import asyncio
import os
from google.cloud import firestore

# --- Configuration ---
AUTH_URL = os.getenv("AUTH_SERVICE_URL", "https://auth-hhqol7siba-uc.a.run.app")
PROFILES_URL = os.getenv("PROFILES_URL", "https://profiles-hhqol7siba-uc.a.run.app")
USERS_URL = os.getenv("USERS_URL", "https://users-hhqol7siba-uc.a.run.app")

# Targeting the test database
FIRESTORE_PROJECT = "tavern-swiper-dev"
DISCOVERY_DB = os.getenv("DISCOVERY_DB", "discovery")

@pytest.fixture(scope="module")
async def auth_user():
    """Fixture to register a new user and return their token/UID."""
    email = f"pubsub-test-{uuid.uuid4().hex[:8]}@example.com"
    password = "TestPassword123!"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Register
        reg_resp = await client.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": password})
        assert reg_resp.status_code == 200
        creds = reg_resp.json()
        
        # 2. Tavern Token
        v_resp = await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": creds["id_token"]})
        assert v_resp.status_code == 200
        token = v_resp.json()["token"]
        
        # 3. User Record
        await client.post(
            f"{USERS_URL}/users/", 
            headers={"Authorization": f"Bearer {token}"},
            json={"email": email}
        )
        
        return {"token": token, "uid": creds["uid"], "email": email}

async def poll_for_cache(profile_id, expected_name, timeout=15):
    """Poll Firestore discovery-test DB for the cached profile."""
    db = firestore.Client(project=FIRESTORE_PROJECT, database=DISCOVERY_DB)
    collection = "profiles_profiles_cache"
    
    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        doc_ref = db.collection(collection).document(profile_id)
        doc = doc_ref.get()
        if doc.exists:
            data = doc.to_dict()
            if expected_name is None or data.get("display_name") == expected_name:
                return data
        await asyncio.sleep(1)
    return None

async def poll_for_deletion(profile_id, timeout=15):
    """Poll Firestore discovery-test DB until the document is gone."""
    db = firestore.Client(project=FIRESTORE_PROJECT, database=DISCOVERY_DB)
    collection = "profiles_profiles_cache"
    
    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        doc_ref = db.collection(collection).document(profile_id)
        if not doc_ref.get().exists:
            return True
        await asyncio.sleep(1)
    return False

@pytest.mark.asyncio
async def test_pubsub_cache_lifecycle(auth_user):
    """
    Integration Test: Full Pub/Sub CRUD Cycle
    1. Create Profile -> Verify Firestore Cache Presence
    2. Update Profile -> Verify Firestore Cache Update
    3. Delete Profile -> Verify Firestore Cache Deletion
    """
    headers = {"Authorization": f"Bearer {auth_user['token']}"}
    initial_name = f"PubSub-Hero-{uuid.uuid4().hex[:4]}"
    updated_name = f"Updated-Hero-{uuid.uuid4().hex[:4]}"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # --- 1. CREATE ---
        print(f"\nCreating profile: {initial_name}")
        create_resp = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=headers,
            json={"display_name": initial_name, "tagline": "Pub/Sub Test", "gender": "Other"}
        )
        assert create_resp.status_code == 201
        profile_id = create_resp.json()["profile_id"]
        
        print(f"Waiting for cache insertion for {profile_id}...")
        cached_doc = await poll_for_cache(profile_id, initial_name)
        assert cached_doc is not None, f"Profile {profile_id} was never cached in {DISCOVERY_DB}"
        assert cached_doc["display_name"] == initial_name
        print("✅ Cache Insertion Verified")

        # --- 2. UPDATE ---
        print(f"Updating profile to: {updated_name}")
        update_resp = await client.put(
            f"{PROFILES_URL}/profiles/{profile_id}",
            headers=headers,
            json={"display_name": updated_name}
        )
        assert update_resp.status_code == 200
        
        print(f"Waiting for cache update for {profile_id}...")
        updated_doc = await poll_for_cache(profile_id, updated_name)
        assert updated_doc is not None, "Cache update failed or took too long"
        assert updated_doc["display_name"] == updated_name
        print("✅ Cache Update Verified")

        # --- 3. DELETE ---
        print(f"Deleting profile: {profile_id}")
        del_resp = await client.delete(f"{PROFILES_URL}/profiles/{profile_id}", headers=headers)
        assert del_resp.status_code == 204
        
        print(f"Waiting for cache deletion for {profile_id}...")
        deleted = await poll_for_deletion(profile_id)
        assert deleted is True, "Cache deletion failed or took too long"
        print("✅ Cache Deletion Verified")
