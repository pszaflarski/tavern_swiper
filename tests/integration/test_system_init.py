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
MESSAGES_URL = os.getenv("MESSAGES_URL", "http://localhost:8005")
USERS_URL = os.getenv("USERS_URL", "http://localhost:8006")

TEST_EMAIL = f"root-test-{uuid.uuid4().hex[:8]}@example.com"
TEST_PASSWORD = "TestPassword123!"

@pytest.fixture(scope="module")
async def auth_token():
    """Fixture to register a new user, promote them to root_admin, and return their elevated token."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Register via Auth Service
        resp = await client.post(
            f"{AUTH_URL}/auth/register",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
        )
        assert resp.status_code == 200, f"Registration failed: {resp.text}"
        id_token = resp.json()["id_token"]
        uid = resp.json()["uid"]

        # 2. Exchange for initial Tavern JWT (role='user' by default)
        verify_resp = await client.post(
            f"{AUTH_URL}/auth/verify",
            json={"id_token": id_token}
        )
        assert verify_resp.status_code == 200
        initial_token = verify_resp.json()["token"]

        # 3. Claim the Root Admin throne (promotion)
        # Note: This is idempotent if already claimed.
        await client.post(
            f"{USERS_URL}/users/", 
            headers={"Authorization": f"Bearer {initial_token}"},
            json={"email": TEST_EMAIL, "user_type": "root_admin"}
        )

        # 4. Exchange for UPGRADED Tavern JWT (role='root_admin')
        verify_resp_final = await client.post(
            f"{AUTH_URL}/auth/verify",
            json={"id_token": id_token}
        )
        assert verify_resp_final.status_code == 200
        elevated_token = verify_resp_final.json()["token"]

        return {"token": elevated_token, "uid": uid}

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

        await asyncio.sleep(2) # Wait for Pub/Sub to Discovery cache propagation

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

        await asyncio.sleep(2) # Wait for Pub/Sub to Discovery cache propagation

        # 2. Test Limit = 1
        feed_1 = await client.get(f"{DISCOVERY_URL}/discovery/feed/{profile_id}?limit=1", headers=headers)
        assert feed_1.status_code == 200
        assert len(feed_1.json()["profiles"]) <= 1

        # 3. Test Limit = 5
        feed_5 = await client.get(f"{DISCOVERY_URL}/discovery/feed/{profile_id}?limit=5", headers=headers)
        assert feed_5.status_code == 200
        assert len(feed_5.json()["profiles"]) <= 5
        
        print(f"\nSuccessfully verified discovery limit for {profile_id}")

@pytest.mark.asyncio
async def test_messaging_and_conversation_flow():
    """
    Integration Test: Full Messaging Flow
    1. Setup User A (A1) and User B (B1)
    2. Setup Match between A1 and B1
    3. User A sends a message to User B
    4. User B replies to User A
    5. Verify both messages appear in chronological order
    6. Verify Inbox for both users
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        # --- 1. Setup Match ---
        # User A
        email_a = f"msg-a-{uuid.uuid4().hex[:8]}@example.com"
        reg_a = await client.post(f"{AUTH_URL}/auth/register", json={"email": email_a, "password": TEST_PASSWORD})
        token_a = (await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": reg_a.json()["id_token"]})).json()["token"]
        headers_a = {"Authorization": f"Bearer {token_a}"}
        await client.post(f"{USERS_URL}/users/", headers=headers_a, json={"email": email_a})
        p_a1_id = (await client.post(f"{PROFILES_URL}/profiles/", headers=headers_a, json={"display_name": "MsgA1"})).json()["profile_id"]

        # User B
        email_b = f"msg-b-{uuid.uuid4().hex[:8]}@example.com"
        reg_b = await client.post(f"{AUTH_URL}/auth/register", json={"email": email_b, "password": TEST_PASSWORD})
        token_b = (await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": reg_b.json()["id_token"]})).json()["token"]
        headers_b = {"Authorization": f"Bearer {token_b}"}
        await client.post(f"{USERS_URL}/users/", headers=headers_b, json={"email": email_b})
        p_b1_id = (await client.post(f"{PROFILES_URL}/profiles/", headers=headers_b, json={"display_name": "MsgB1"})).json()["profile_id"]

        # Mutual Swipe
        await client.post(f"{DISCOVERY_URL}/discovery/swipe/", headers=headers_a, json={"swiper_profile_id": p_a1_id, "swiped_profile_id": p_b1_id, "direction": "right"})
        swipe_b = await client.post(f"{DISCOVERY_URL}/discovery/swipe/", headers=headers_b, json={"swiper_profile_id": p_b1_id, "swiped_profile_id": p_a1_id, "direction": "right"})
        match_id = swipe_b.json()["id"]
        assert match_id is not None

        # --- 2. Verify Match Metadata ---
        match_resp = await client.get(f"{DISCOVERY_URL}/discovery/matches/{match_id}", headers=headers_a)
        assert match_resp.status_code == 200
        assert p_a1_id in match_resp.json()["profiles"]
        assert p_b1_id in match_resp.json()["profiles"]

        # --- 3. User A Sends Message ---
        content_a = "Greetings from the high tower!"
        msg_a_resp = await client.post(
            f"{MESSAGES_URL}/messages/",
            headers=headers_a,
            json={"match_id": match_id, "sender_profile_id": p_a1_id, "content": content_a}
        )
        assert msg_a_resp.status_code == 201
        
        # --- 4. User B Replies ---
        content_b = "And a low bow from the valley."
        msg_b_resp = await client.post(
            f"{MESSAGES_URL}/messages/",
            headers=headers_b,
            json={"match_id": match_id, "sender_profile_id": p_b1_id, "content": content_b}
        )
        assert msg_b_resp.status_code == 201

        # --- 5. Verify History ---
        history_resp = await client.get(f"{MESSAGES_URL}/messages/{match_id}", headers=headers_a)
        assert history_resp.status_code == 200
        history = history_resp.json()
        assert len(history) == 2
        assert history[0]["content"] == content_a
        assert history[1]["content"] == content_b

        # --- 6. Verify Inbox (Conversations) ---
        inbox_a_resp = await client.get(f"{MESSAGES_URL}/messages/conversations/{p_a1_id}", headers=headers_a)
        assert inbox_a_resp.status_code == 200
        inbox_a = inbox_a_resp.json()
        assert len(inbox_a) >= 1
        # The latest message for this match should be content_b
        conv_a = next(c for c in inbox_a if c["match_id"] == match_id)
        assert conv_a["last_message"]["content"] == content_b

        print(f"\nSuccessfully verified messaging flow for match {match_id}")

@pytest.mark.asyncio
async def test_login_flow():
    """Verify registration followed by login returns a valid token."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        email = f"login-{uuid.uuid4().hex[:8]}@example.com"
        # 1. Register
        reg = await client.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": TEST_PASSWORD})
        assert reg.status_code == 200
        
        # 2. Login
        log = await client.post(f"{AUTH_URL}/auth/login", json={"email": email, "password": TEST_PASSWORD})
        assert log.status_code == 200
        assert "id_token" in log.json()
        print(f"\nSuccessfully verified login flow for {email}")

@pytest.mark.asyncio
async def test_profile_lifecycle():
    """Verify profile creation, update, and deletion."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Auth setup
        email = f"profile-lc-{uuid.uuid4().hex[:8]}@example.com"
        reg = await client.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": TEST_PASSWORD})
        token = (await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": reg.json()["id_token"]})).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        await client.post(f"{USERS_URL}/users/", headers=headers, json={"email": email})

        # 1. Create
        resp = await client.post(f"{PROFILES_URL}/profiles/", headers=headers, json={"display_name": "Initial Name"})
        assert resp.status_code == 201
        pid = resp.json()["profile_id"]

        # 2. Update
        resp = await client.put(f"{PROFILES_URL}/profiles/{pid}", headers=headers, json={"display_name": "Updated Name"})
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "Updated Name"

        # 3. Delete
        resp = await client.delete(f"{PROFILES_URL}/profiles/{pid}", headers=headers)
        assert resp.status_code == 204

        # 4. Verify 404
        resp = await client.get(f"{PROFILES_URL}/profiles/{pid}", headers=headers)
        assert resp.status_code == 404
        print(f"\nSuccessfully verified profile lifecycle for {pid}")

@pytest.mark.asyncio
async def test_left_swipe_exclusion():
    """Verify that profiles swiped LEFT are excluded from future discovery feeds."""
    async with httpx.AsyncClient(timeout=35.0) as client:
        # Setup User A
        email_a = f"swiper-{uuid.uuid4().hex[:8]}@example.com"
        reg_a = await client.post(f"{AUTH_URL}/auth/register", json={"email": email_a, "password": TEST_PASSWORD})
        token_a = (await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": reg_a.json()["id_token"]})).json()["token"]
        headers_a = {"Authorization": f"Bearer {token_a}"}
        await client.post(f"{USERS_URL}/users/", headers=headers_a, json={"email": email_a})
        p_a_id = (await client.post(f"{PROFILES_URL}/profiles/", headers=headers_a, json={"display_name": "SwiperA"})).json()["profile_id"]

        # Setup User B
        email_b = f"swiped-{uuid.uuid4().hex[:8]}@example.com"
        reg_b = await client.post(f"{AUTH_URL}/auth/register", json={"email": email_b, "password": TEST_PASSWORD})
        token_b = (await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": reg_b.json()["id_token"]})).json()["token"]
        headers_b = {"Authorization": f"Bearer {token_b}"}
        await client.post(f"{USERS_URL}/users/", headers=headers_b, json={"email": email_b})
        p_b_id = (await client.post(f"{PROFILES_URL}/profiles/", headers=headers_b, json={"display_name": "SwiperB"})).json()["profile_id"]

        await asyncio.sleep(2) # Wait for Pub/Sub to Discovery cache propagation

        # 1. Verify B is in A's feed initially
        feed_init = await client.get(f"{DISCOVERY_URL}/discovery/feed/{p_a_id}", headers=headers_a)
        p_ids = [p["profile_id"] for p in feed_init.json()["profiles"]]
        assert p_b_id in p_ids

        # 2. A swipes LEFT on B
        await client.post(f"{DISCOVERY_URL}/discovery/swipe/", headers=headers_a, 
                         json={"swiper_profile_id": p_a_id, "swiped_profile_id": p_b_id, "direction": "left"})

        # 3. Verify B is NOT in A's feed anymore
        feed_after = await client.get(f"{DISCOVERY_URL}/discovery/feed/{p_a_id}", headers=headers_a)
        p_ids_after = [p["profile_id"] for p in feed_after.json()["profiles"]]
        assert p_b_id not in p_ids_after
        print(f"\nSuccessfully verified left-swipe exclusion for profile {p_b_id}")

@pytest.mark.asyncio
async def test_user_account_management():
    """Verify GET /users/me and PUT /users/me."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        email = f"user-mgmt-{uuid.uuid4().hex[:8]}@example.com"
        reg = await client.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": TEST_PASSWORD})
        token = (await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": reg.json()["id_token"]})).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        await client.post(f"{USERS_URL}/users/", headers=headers, json={"email": email})

        # 1. Fetch account info
        resp = await client.get(f"{USERS_URL}/users/me", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["email"] == email
        assert resp.json()["is_premium"] is False

        # 2. Update account info (Premium status)
        resp = await client.put(f"{USERS_URL}/users/me", headers=headers, json={"is_premium": True})
        assert resp.status_code == 200
        assert resp.json()["is_premium"] is True
        print(f"\nSuccessfully verified user account management for {email}")

@pytest.mark.asyncio
async def test_active_profile_switching():
    """Verify profile auto-activation and manual switching."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        email = f"switcher-{uuid.uuid4().hex[:8]}@example.com"
        reg = await client.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": TEST_PASSWORD})
        token = (await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": reg.json()["id_token"]})).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        await client.post(f"{USERS_URL}/users/", headers=headers, json={"email": email})

        # 1. Create P1 (will be active)
        p1_id = (await client.post(f"{PROFILES_URL}/profiles/", headers=headers, json={"display_name": "P1"})).json()["profile_id"]
        p1 = (await client.get(f"{PROFILES_URL}/profiles/{p1_id}", headers=headers)).json()
        assert p1["is_active"] is True

        # 2. Create P2 (will become active, deactivating P1)
        p2_id = (await client.post(f"{PROFILES_URL}/profiles/", headers=headers, json={"display_name": "P2"})).json()["profile_id"]
        
        # Verify P2 is active, P1 is inactive
        p2 = (await client.get(f"{PROFILES_URL}/profiles/{p2_id}", headers=headers)).json()
        p1_after = (await client.get(f"{PROFILES_URL}/profiles/{p1_id}", headers=headers)).json()
        assert p2["is_active"] is True
        assert p1_after["is_active"] is False

        # 3. Manually switch back to P1
        await client.post(f"{PROFILES_URL}/profiles/{p1_id}/set_active", headers=headers)
        
        # Verify P1 is active, P2 is inactive
        p1_final = (await client.get(f"{PROFILES_URL}/profiles/{p1_id}", headers=headers)).json()
        p2_final = (await client.get(f"{PROFILES_URL}/profiles/{p2_id}", headers=headers)).json()
        assert p1_final["is_active"] is True
        assert p2_final["is_active"] is False
        print(f"\nSuccessfully verified profile switching for user {email}")

@pytest.mark.asyncio
async def test_user_profiles_listing():
    """Verify GET /profiles/user/{user_id}."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        email = f"listing-{uuid.uuid4().hex[:8]}@example.com"
        reg = await client.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": TEST_PASSWORD})
        resp_verify = await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": reg.json()["id_token"]})
        token = resp_verify.json()["token"]
        uid = resp_verify.json()["uid"]
        headers = {"Authorization": f"Bearer {token}"}
        await client.post(f"{USERS_URL}/users/", headers=headers, json={"email": email})

        # Create two profiles
        await client.post(f"{PROFILES_URL}/profiles/", headers=headers, json={"display_name": "Profile 1"})
        await client.post(f"{PROFILES_URL}/profiles/", headers=headers, json={"display_name": "Profile 2"})

        # Verify listing
        resp = await client.get(f"{PROFILES_URL}/profiles/user/{uid}", headers=headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 2
        print(f"\nSuccessfully verified user profiles listing for {uid}")

@pytest.mark.asyncio
async def test_user_soft_delete_and_restore(auth_token):
    """Verify Admin-level soft-delete and restoration of users."""
    # Use 'auth_token' fixture for Root Admin context
    headers_admin = {"Authorization": f"Bearer {auth_token['token']}"}
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Setup a Target User
        target_email = f"softdelete-{uuid.uuid4().hex[:8]}@example.com"
        reg = await client.post(f"{AUTH_URL}/auth/register", json={"email": target_email, "password": TEST_PASSWORD})
        target_uid = reg.json()["uid"]
        # Create record in Users service
        await client.post(f"{USERS_URL}/users/", headers=headers_admin, json={"email": target_email, "uid": target_uid})

        # 2. Soft-delete the user
        resp_del = await client.delete(f"{USERS_URL}/users/{target_uid}?hard=false", headers=headers_admin)
        assert resp_del.status_code == 204

        # 3. Verify user is excluded from default list
        resp_list = await client.get(f"{USERS_URL}/users/", headers=headers_admin)
        uids = [u["uid"] for u in resp_list.json()]
        assert target_uid not in uids

        # 4. Restore the user
        resp_rest = await client.patch(f"{USERS_URL}/users/{target_uid}/restore", headers=headers_admin)
        assert resp_rest.status_code == 200
        assert resp_rest.json()["is_deleted"] is False

        # 5. Verify user is back in list
        resp_list_final = await client.get(f"{USERS_URL}/users/", headers=headers_admin)
        uids_final = [u["uid"] for u in resp_list_final.json()]
        assert target_uid in uids_final
        print(f"\nSuccessfully verified soft-delete and restore for user {target_uid}")
@pytest.mark.asyncio
async def test_empty_match_appears_in_inbox():
    """
    Integration Test: Empty Match Visibility
    1. Setup User A (A1) and User B (B1)
    2. Setup Match between A1 and B1
    3. Verify that A1's inbox shows the match with last_message=None
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        # User A
        email_a = f"empty-a-{uuid.uuid4().hex[:8]}@example.com"
        reg_a = await client.post(f"{AUTH_URL}/auth/register", json={"email": email_a, "password": TEST_PASSWORD})
        token_a = (await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": reg_a.json()["id_token"]})).json()["token"]
        headers_a = {"Authorization": f"Bearer {token_a}"}
        await client.post(f"{USERS_URL}/users/", headers=headers_a, json={"email": email_a})
        p_a1_id = (await client.post(f"{PROFILES_URL}/profiles/", headers=headers_a, json={"display_name": "EmptyA1"})).json()["profile_id"]

        # User B
        email_b = f"empty-b-{uuid.uuid4().hex[:8]}@example.com"
        reg_b = await client.post(f"{AUTH_URL}/auth/register", json={"email": email_b, "password": TEST_PASSWORD})
        token_b = (await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": reg_b.json()["id_token"]})).json()["token"]
        headers_b = {"Authorization": f"Bearer {token_b}"}
        await client.post(f"{USERS_URL}/users/", headers=headers_b, json={"email": email_b})
        p_b1_id = (await client.post(f"{PROFILES_URL}/profiles/", headers=headers_b, json={"display_name": "EmptyB1"})).json()["profile_id"]

        # Mutual Swipe
        await client.post(f"{DISCOVERY_URL}/discovery/swipe/", headers=headers_a, json={"swiper_profile_id": p_a1_id, "swiped_profile_id": p_b1_id, "direction": "right"})
        swipe_b = await client.post(f"{DISCOVERY_URL}/discovery/swipe/", headers=headers_b, json={"swiper_profile_id": p_b1_id, "swiped_profile_id": p_a1_id, "direction": "right"})
        match_id = swipe_b.json()["id"]
        assert match_id is not None

        # --- Verify Inbox shows empty match ---
        inbox_a_resp = await client.get(f"{MESSAGES_URL}/messages/conversations/{p_a1_id}", headers=headers_a)
        assert inbox_a_resp.status_code == 200
        inbox_a = inbox_a_resp.json()
        assert len(inbox_a) >= 1
        
        conv_a = next(c for c in inbox_a if c["match_id"] == match_id)
        assert conv_a["last_message"] is None
        assert conv_a["other_profile_id"] == p_b1_id
        
        print(f"\nSuccessfully verified empty match {match_id} appears in inbox for {p_a1_id}")
