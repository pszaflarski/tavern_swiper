import pytest
import httpx
import uuid
import asyncio
import os
from google.cloud import firestore
from .helpers import register_user, AUTH_URL, PROFILES_URL, USERS_URL

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
    async with httpx.AsyncClient(timeout=30.0) as client:
        return await register_user(client)

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

async def poll_for_active_status(profile_id, expected_active, timeout=15):
    """Poll Firestore discovery-test DB for the active status of a profile."""
    db = firestore.Client(project=FIRESTORE_PROJECT, database=DISCOVERY_DB)
    collection = "profiles_profiles_cache"
    
    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        doc_ref = db.collection(collection).document(profile_id)
        doc = doc_ref.get()
        if doc.exists:
            data = doc.to_dict()
            if data.get("is_active") == expected_active:
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

@pytest.mark.asyncio
async def test_active_profile_switch_propagation(auth_user):
    """
    Integration Test: Active Profile Propagation
    1. Create Profile A -> Verify active in cache
    2. Create Profile B -> Verify B is active, A is inactive in cache
    3. Set A Active -> Verify A is active, B is inactive in cache
    """
    headers = {"Authorization": f"Bearer {auth_user['token']}"}
    name_a = f"A-{uuid.uuid4().hex[:4]}"
    name_b = f"B-{uuid.uuid4().hex[:4]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        # --- 1. Create Profile A ---
        print(f"\nCreating Profile A: {name_a}")
        resp_a = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=headers,
            json={"display_name": name_a, "tagline": "Test A", "gender": "Other"}
        )
        assert resp_a.status_code == 201
        id_a = resp_a.json()["profile_id"]

        print(f"Verifying A is active in cache...")
        doc_a = await poll_for_active_status(id_a, True)
        assert doc_a is not None and doc_a["is_active"] is True

        # --- 2. Create Profile B (Auto-deactivates A) ---
        print(f"Creating Profile B: {name_b}")
        resp_b = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=headers,
            json={"display_name": name_b, "tagline": "Test B", "gender": "Other"}
        )
        assert resp_b.status_code == 201
        id_b = resp_b.json()["profile_id"]

        print("Verifying B is active and A is inactive in cache...")
        doc_b = await poll_for_active_status(id_b, True)
        assert doc_b is not None and doc_b["is_active"] is True
        
        doc_a_inactive = await poll_for_active_status(id_a, False)
        assert doc_a_inactive is not None and doc_a_inactive["is_active"] is False
        print("✅ Auto-Switch Propagation Verified")

        # --- 3. Manual Switch back to A ---
        print(f"Setting Profile A ({id_a}) as active...")
        switch_resp = await client.post(
            f"{PROFILES_URL}/profiles/{id_a}/set_active",
            headers=headers
        )
        assert switch_resp.status_code == 200

        print("Verifying A is active and B is inactive in cache...")
        doc_a_active = await poll_for_active_status(id_a, True)
        assert doc_a_active is not None and doc_a_active["is_active"] is True
        
        doc_b_inactive = await poll_for_active_status(id_b, False)
        assert doc_b_inactive is not None and doc_b_inactive["is_active"] is False
        print("✅ Manual Switch Propagation Verified")
