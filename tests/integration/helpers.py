import uuid
import httpx
import os

AUTH_URL = os.getenv("AUTH_SERVICE_URL", "http://localhost:8001")
USERS_URL = os.getenv("USERS_URL", "http://localhost:8006")
PROFILES_URL = os.getenv("PROFILES_URL", "http://localhost:8002")
DISCOVERY_URL = os.getenv("DISCOVERY_URL", "http://localhost:8003")
MESSAGES_URL = os.getenv("MESSAGES_URL", "http://localhost:8005")
TEST_PASSWORD = os.getenv("ROOT_PASSWORD", "TestPassword123!")
ROOT_EMAIL = os.getenv("ROOT_EMAIL", "root@example.com")

_ROOT_CONTEXT = None

async def get_root_admin(client: httpx.AsyncClient):
    """Ensure a root admin exists and return its token and UID."""
    global _ROOT_CONTEXT
    if _ROOT_CONTEXT:
        return _ROOT_CONTEXT

    # 1. Attempt Login
    login_resp = await client.post(f"{AUTH_URL}/auth/login", json={"email": ROOT_EMAIL, "password": TEST_PASSWORD})
    if login_resp.status_code == 200:
        data = login_resp.json()
        id_token, uid = data["id_token"], data["uid"]
    else:
        # 2. Fallback to Register
        reg_resp = await client.post(f"{AUTH_URL}/auth/register", json={"email": ROOT_EMAIL, "password": TEST_PASSWORD})
        if reg_resp.status_code != 200:
            # If registration fails with "Too many attempts", we can't bootstrap.
            # But normally this happens once and then we use the cached context or login.
            raise Exception(f"Failed to bootstrap Root Admin: {reg_resp.text}")
        data = reg_resp.json()
        id_token, uid = data["id_token"], data["uid"]
    
    # 3. Exchange for Tavern Token
    v_resp = await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token})
    assert v_resp.status_code == 200, f"Root verification failed: {v_resp.text}"
    initial_token = v_resp.json()["token"]

    # 4. Promote to root_admin (idempotent)
    await client.post(
        f"{USERS_URL}/users/", 
        headers={"Authorization": f"Bearer {initial_token}"},
        json={"email": ROOT_EMAIL, "user_type": "root_admin"}
    )

    # 5. Get elevated token
    v_resp_final = await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token})
    assert v_resp_final.status_code == 200, f"Root elevated verification failed: {v_resp_final.text}"
    elevated_token = v_resp_final.json()["token"]

    _ROOT_CONTEXT = {"token": elevated_token, "uid": uid, "email": ROOT_EMAIL}
    return _ROOT_CONTEXT

async def register_user(client: httpx.AsyncClient, email=None):
    """
    Registers a user. Defaults to dev-mint (high speed), but can be switched to 
    real Firebase Auth via `--real-auth` (sets USE_REAL_FIREBASE_AUTH).
    """
    if email is None:
        email = f"test-{uuid.uuid4().hex[:8]}@example.com"
    
    use_real = os.getenv("USE_REAL_FIREBASE_AUTH", "false").lower() == "true"
    
    if use_real:
        # --- Real Firebase Auth Flow ---
        password = "TestPassword123!"
        # 1. Register
        reg_resp = await client.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": password})
        assert reg_resp.status_code == 200, f"Real register failed: {reg_resp.text}"
        data = reg_resp.json()
        uid, id_token = data["uid"], data["id_token"]

        # 2. Verify / Exchange for Tavern Token
        v_resp = await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token})
        assert v_resp.status_code == 200, f"Real verify failed: {v_resp.text}"
        token = v_resp.json()["token"]

        # 3. Hydreation (Self-hydration is allowed)
        await client.post(
            f"{USERS_URL}/users/",
            headers={"Authorization": f"Bearer {token}"},
            json={"email": email, "user_type": "user"}
        )
    else:
        # --- Dev-Mint Flow (Default) ---
        # We use a deterministic UID for tests to avoid collisions and make tracking easier
        uid = f"uid-{uuid.uuid4().hex[:12]}"

        # 1. Mint Tavern Token directly (No Firebase call)
        mint_resp = await client.post(
            f"{AUTH_URL}/auth/dev-mint",
            json={"uid": uid, "email": email, "role": "user"}
        )
        assert mint_resp.status_code == 200, f"Dev mint failed: {mint_resp.text}"
        token = mint_resp.json()["token"]

        # 2. Hydrate user record using ROOT ADMIN (One root admin call per session)
        root = await get_root_admin(client)
        user_resp = await client.post(
            f"{USERS_URL}/users/",
            headers={"Authorization": f"Bearer {root['token']}"},
            json={"email": email, "uid": uid, "user_type": "user"}
        )
        assert user_resp.status_code in [201, 200], f"User hydration failed: {user_resp.text}"
    
    return {"token": token, "uid": uid, "email": email}

async def create_profile(client: httpx.AsyncClient, token: str, display_name: str):
    """Utility to create a profile for a user."""
    resp = await client.post(
        f"{PROFILES_URL}/profiles/",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "display_name": display_name,
            "bio": f"Profile for {display_name}",
            "gender": []
        }
    )
    assert resp.status_code == 201, f"Profile creation failed: {resp.text}"
    return resp.json()["profile_id"]
