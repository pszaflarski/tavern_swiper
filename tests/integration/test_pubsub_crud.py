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
FIRESTORE_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
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

async def poll_for_cache_absent(profile_id, timeout=15):
    """Poll Firestore discovery DB to verify the profile is NOT in cache."""
    db = firestore.Client(project=FIRESTORE_PROJECT, database=DISCOVERY_DB)
    collection = "profiles_profiles_cache"
    
    start_time = asyncio.get_event_loop().time()
    while (asyncio.get_event_loop().time() - start_time) < timeout:
        doc_ref = db.collection(collection).document(profile_id)
        doc = doc_ref.get()
        if not doc.exists:
            return True
        await asyncio.sleep(1)
    return False

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
            json={"display_name": initial_name, "tagline": "Pub/Sub Test", "gender": []}
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
async def test_cached_profile_has_no_is_active(auth_user):
    """
    Integration Test: Verify is_active is NOT in the discovery cache.
    1. Create Profile -> Verify it appears in cache
    2. Verify is_active field is absent from cached data
    """
    headers = {"Authorization": f"Bearer {auth_user['token']}"}
    name = f"NoActive-{uuid.uuid4().hex[:4]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        print(f"\nCreating profile: {name}")
        resp = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=headers,
            json={"display_name": name, "tagline": "is_active test", "gender": []}
        )
        assert resp.status_code == 201
        profile_id = resp.json()["profile_id"]

        print(f"Waiting for cache insertion for {profile_id}...")
        cached_doc = await poll_for_cache(profile_id, name)
        assert cached_doc is not None, f"Profile {profile_id} was never cached"

        # Verify is_active is NOT in the cached data
        assert "is_active" not in cached_doc, \
            f"is_active should NOT be in discovery cache, but found: {cached_doc.get('is_active')}"
        print("✅ is_active correctly absent from cache")

        # Cleanup
        await client.delete(f"{PROFILES_URL}/profiles/{profile_id}", headers=headers)

@pytest.mark.asyncio
async def test_pubsub_bulk_deletion_purges_cache(auth_user):
    """
    Integration Test: Bulk Delete (ALL_DELETED) purges the discovery cache.
    1. Create two profiles -> Verify both are in cache
    2. Root admin purges all profiles
    3. Verify both profiles are removed from cache
    """
    headers = {"Authorization": f"Bearer {auth_user['token']}"}
    name_a = f"BulkA-{uuid.uuid4().hex[:4]}"
    name_b = f"BulkB-{uuid.uuid4().hex[:4]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Create profiles
        print(f"\nCreating profiles: {name_a}, {name_b}")
        resp_a = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=headers,
            json={"display_name": name_a, "tagline": "Bulk test", "gender": []}
        )
        assert resp_a.status_code == 201
        id_a = resp_a.json()["profile_id"]

        resp_b = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=headers,
            json={"display_name": name_b, "tagline": "Bulk test", "gender": []}
        )
        assert resp_b.status_code == 201
        id_b = resp_b.json()["profile_id"]

        # Wait for both to appear in cache
        cached_a = await poll_for_cache(id_a, name_a)
        cached_b = await poll_for_cache(id_b, name_b)
        assert cached_a is not None, f"Profile {id_a} was never cached"
        assert cached_b is not None, f"Profile {id_b} was never cached"
        print("✅ Both profiles cached")

        # Get root admin token for bulk delete
        from .helpers import get_root_admin
        root = await get_root_admin(client)
        admin_headers = {"Authorization": f"Bearer {root['token']}"}

        # Purge all profiles
        print("Purging all profiles...")
        del_resp = await client.delete(f"{PROFILES_URL}/profiles/", headers=admin_headers)
        assert del_resp.status_code == 200

        # Verify both are removed from cache
        print(f"Waiting for cache purge of {id_a} and {id_b}...")
        deleted_a = await poll_for_deletion(id_a)
        deleted_b = await poll_for_deletion(id_b)
        assert deleted_a is True, f"Profile {id_a} was not purged from cache"
        assert deleted_b is True, f"Profile {id_b} was not purged from cache"
        print("✅ Bulk Cache Purge Verified")
