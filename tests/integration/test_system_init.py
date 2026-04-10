import pytest
import httpx
import uuid
import asyncio

# --- Configuration ---
import os
# --- Configuration ---
# Fallback to local docker-compose-test.yml if env vars are not set
AUTH_URL = os.getenv("AUTH_SERVICE_URL", "http://localhost:8001")
PROFILES_URL = os.getenv("PROFILES_URL", "http://localhost:8002")
DISCOVERY_URL = os.getenv("DISCOVERY_URL", "http://localhost:8003")
USERS_URL = os.getenv("USERS_URL", "http://localhost:8006")

TEST_EMAIL = f"root-test-{uuid.uuid4().hex[:8]}@example.com"
TEST_PASSWORD = "TestPassword123!"

@pytest.fixture(scope="module")
async def auth_token():
    """Fixture to register a new user and return their custom Tavern token."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Register via Auth Service
        resp = await client.post(
            f"{AUTH_URL}/auth/register",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        assert resp.status_code == 200, f"Registration failed: {resp.text}"
        id_token = resp.json()["id_token"]
        uid = resp.json()["uid"]

        # 2. Exchange for custom Tavern JWT
        verify_resp = await client.post(
            f"{AUTH_URL}/auth/verify",
            json={"id_token": id_token}
        )
        assert verify_resp.status_code == 200, f"Auth verification failed: {verify_resp.text}"
        tavern_token = verify_resp.json()["token"]

        return {"token": tavern_token, "uid": uid}

@pytest.mark.asyncio
async def test_root_initialization_flow(auth_token):
    """
    Integration Test:
    1. Register root user in Auth (done in fixture)
    2. Initialize User record as 'root_admin' in Users Service
    3. Create Profile in Profiles Service
    """
    # auth_token is an awaited object if using pytest-asyncio properly
    token = auth_token["token"]
    uid = auth_token["uid"]
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        # --- Step 1: Initialize Root Admin ---
        user_resp = await client.post(
            f"{USERS_URL}/users/",
            headers=headers,
            json={
                "email": TEST_EMAIL,
                "user_type": "root_admin",
                "full_name": "Root Test Admin"
            }
        )
        assert user_resp.status_code == 201, f"User initialization failed: {user_resp.text}"
        user_data = user_resp.json()
        assert user_data["user_type"] == "root_admin"
        assert user_data["uid"] == uid

        # --- Step 2: Create Profile ---
        profile_resp = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=headers,
            json={
                "display_name": "Archmage Root",
                "tagline": "Guardian of the Tavern",
                "bio": "The first soul to manifest in this realm.",
                "gender": "Other"
            }
        )
        assert profile_resp.status_code == 201, f"Profile creation failed: {profile_resp.text}"
        profile_data = profile_resp.json()
        assert profile_data["display_name"] == "Archmage Root"
        assert profile_data["user_id"] == uid
        
        print(f"\nSuccessfully created root user {uid} and profile {profile_data['profile_id']}")

@pytest.mark.asyncio
async def test_user_self_registration_flow():
    """
    Integration Test: Normal User Self-Registration
    1. Register via Auth
    2. Self-register in Users service
    3. Create Profile
    """
    email = f"user-{uuid.uuid4().hex[:8]}@example.com"
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Auth Registration
        reg_resp = await client.post(
            f"{AUTH_URL}/auth/register",
            json={"email": email, "password": TEST_PASSWORD}
        )
        assert reg_resp.status_code == 200
        id_token = reg_resp.json()["id_token"]
        uid = reg_resp.json()["uid"]

        # 1b. Exchange for Tavern Token
        v_resp = await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token})
        assert v_resp.status_code == 200
        token = v_resp.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Users Self-Registration
        user_resp = await client.post(
            f"{USERS_URL}/users/",
            headers=headers,
            json={"email": email, "user_type": "user"}
        )
        assert user_resp.status_code == 201
        assert user_resp.json()["user_type"] == "user"

        # 3. Create Profile
        profile_resp = await client.post(
            f"{PROFILES_URL}/profiles/",
            headers=headers,
            json={
                "display_name": "New Adventurer",
                "bio": "A fresh recruit from the woods.",
                "gender": "Man"
            }
        )
        assert profile_resp.status_code == 201
        assert profile_resp.json()["user_id"] == uid
        print(f"\nSuccessfully self-registered user {uid} and created profile.")

@pytest.mark.asyncio
async def test_multi_profile_discovery_and_matching():
    """
    Integration Test: Multi-Profile & Mutual Matching
    User A (Profile A1, Profile A2) <-> User B (Profile B1)
    1. Setup User A with 2 profiles
    2. Setup User B with 1 profile
    3. User A (A1) swipes RIGHT on B1
    4. User B (B1) swipes RIGHT on A1
    5. Verify Match is created for both A1 and B1
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        # --- 1. Setup User A ---
        email_a = f"user-a-{uuid.uuid4().hex[:8]}@example.com"
        reg_a = await client.post(f"{AUTH_URL}/auth/register", json={"email": email_a, "password": TEST_PASSWORD})
        id_token_a = reg_a.json()["id_token"]
        v_a = await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token_a})
        token_a = v_a.json()["token"]
        headers_a = {"Authorization": f"Bearer {token_a}"}
        await client.post(f"{USERS_URL}/users/", headers=headers_a, json={"email": email_a})
        
        # Create A1
        p_a1_resp = await client.post(f"{PROFILES_URL}/profiles/", headers=headers_a, json={"display_name": "A1"})
        p_a1_id = p_a1_resp.json()["profile_id"]
        # Create A2
        p_a2_resp = await client.post(f"{PROFILES_URL}/profiles/", headers=headers_a, json={"display_name": "A2"})
        p_a2_id = p_a2_resp.json()["profile_id"]

        # --- 2. Setup User B ---
        email_b = f"user-b-{uuid.uuid4().hex[:8]}@example.com"
        reg_b = await client.post(f"{AUTH_URL}/auth/register", json={"email": email_b, "password": TEST_PASSWORD})
        id_token_b = reg_b.json()["id_token"]
        v_b = await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token_b})
        token_b = v_b.json()["token"]
        headers_b = {"Authorization": f"Bearer {token_b}"}
        await client.post(f"{USERS_URL}/users/", headers=headers_b, json={"email": email_b})
        
        # Create B1
        p_b1_resp = await client.post(f"{PROFILES_URL}/profiles/", headers=headers_b, json={"display_name": "B1"})
        p_b1_id = p_b1_resp.json()["profile_id"]

        # --- 3. User A (A1) Swipes RIGHT on B1 ---
        # Get feed for A1
        feed_a1 = await client.get(f"{DISCOVERY_URL}/discovery/feed/{p_a1_id}", headers=headers_a)
        if feed_a1.status_code != 200:
            print(f"Discovery failed: {feed_a1.text}")
        assert feed_a1.status_code == 200, f"Discovery failed with {feed_a1.status_code}: {feed_a1.text}"
        profile_ids_in_feed = [p["profile_id"] for p in feed_a1.json()["profiles"]]
        assert p_b1_id in profile_ids_in_feed
        assert p_a1_id not in profile_ids_in_feed # Self-exclusion
        assert p_a2_id in profile_ids_in_feed # Multi-profile discovery (Should see other profiles on same account)

        # Swipe RIGHT
        swipe_a_resp = await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers=headers_a,
            json={"swiper_profile_id": p_a1_id, "swiped_profile_id": p_b1_id, "direction": "right"}
        )
        assert swipe_a_resp.status_code == 201

        # --- 4. User B (B1) Swipes RIGHT on A1 ---
        # Swipe RIGHT
        swipe_b_resp = await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers=headers_b,
            json={"swiper_profile_id": p_b1_id, "swiped_profile_id": p_a1_id, "direction": "right"}
        )
        assert swipe_b_resp.status_code == 201

        # --- 5. Verify Match ---
        # Check matches for A1
        matches_a1 = await client.get(f"{DISCOVERY_URL}/discovery/matches/profile/{p_a1_id}", headers=headers_a)
        assert matches_a1.status_code == 200
        # In current Discovery, matches are returned as MatchOut: { id, profiles, created_at }
        matches_a1_data = matches_a1.json()
        match_profiles_a1 = []
        for m in matches_a1_data:
            match_profiles_a1.extend([p for p in m["profiles"] if p != p_a1_id])
        assert p_b1_id in match_profiles_a1

        # Check matches for B1
        matches_b1 = await client.get(f"{DISCOVERY_URL}/discovery/matches/profile/{p_b1_id}", headers=headers_b)
        assert matches_b1.status_code == 200
        matches_b1_data = matches_b1.json()
        match_profiles_b1 = []
        for m in matches_b1_data:
            match_profiles_b1.extend([p for p in m["profiles"] if p != p_b1_id])
        assert p_a1_id in match_profiles_b1
        
        print(f"\nSuccessfully matched {p_a1_id} and {p_b1_id}")

@pytest.mark.asyncio
async def test_root_singleton_enforcement(auth_token):
    """Verify that a second root admin cannot be created."""
    # Register another user
    async with httpx.AsyncClient(timeout=30.0) as client:
        other_email = f"other-{uuid.uuid4().hex[:8]}@example.com"
        reg_resp = await client.post(
            f"{AUTH_URL}/auth/register",
            json={"email": other_email, "password": TEST_PASSWORD}
        )
        assert reg_resp.status_code == 200
        id_token_other = reg_resp.json()["id_token"]
        v_ohter = await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token_other})
        other_token = v_ohter.json()["token"]
        
        # Try to init as root_admin
        headers = {"Authorization": f"Bearer {other_token}"}
        user_resp = await client.post(
            f"{USERS_URL}/users/",
            headers=headers,
            json={
                "email": other_email,
                "user_type": "root_admin"
            }
        )
        
        # Should fail with 400 "A root admin already exists"
        assert user_resp.status_code == 400, f"Expected 400, got {user_resp.status_code}. Data: {user_resp.text}"
        assert "root admin already exists" in user_resp.text.lower()

@pytest.mark.asyncio
async def test_discovery_feed_limit():
    """Verify the 'limit' query parameter on the discovery feed."""
    email = f"limit-user-{uuid.uuid4().hex[:8]}@example.com"
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Setup User & Profile
        reg_resp = await client.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": TEST_PASSWORD})
        id_token = reg_resp.json()["id_token"]
        v_resp = await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token})
        token = v_resp.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        
        await client.post(f"{USERS_URL}/users/", headers=headers, json={"email": email})
        p_resp = await client.post(f"{PROFILES_URL}/profiles/", headers=headers, json={"display_name": "Limit Tester"})
        profile_id = p_resp.json()["profile_id"]

        # 2. Test Limit = 1
        feed_1 = await client.get(f"{DISCOVERY_URL}/discovery/feed/{profile_id}?limit=1", headers=headers)
        assert feed_1.status_code == 200
        assert len(feed_1.json()["profiles"]) <= 1

        # 3. Test Limit = 5
        feed_5 = await client.get(f"{DISCOVERY_URL}/discovery/feed/{profile_id}?limit=5", headers=headers)
        assert feed_5.status_code == 200
        assert len(feed_5.json()["profiles"]) <= 5
        
        print(f"\nSuccessfully verified discovery limit for {profile_id}")
