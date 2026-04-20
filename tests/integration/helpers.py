import uuid
import httpx
import os

AUTH_URL = os.getenv("AUTH_SERVICE_URL", "http://localhost:8001")
USERS_URL = os.getenv("USERS_URL", "http://localhost:8006")
PROFILES_URL = os.getenv("PROFILES_URL", "http://localhost:8002")
TEST_PASSWORD = "TestPassword123!"

async def register_user(client: httpx.AsyncClient, email=None):
    """Utility to register a new user and return their Tavern token and UID."""
    if email is None:
        email = f"user-{uuid.uuid4().hex[:8]}@example.com"
    
    # 1. Auth Registration
    reg_resp = await client.post(
        f"{AUTH_URL}/auth/register",
        json={"email": email, "password": TEST_PASSWORD}
    )
    assert reg_resp.status_code == 200, f"Auth registration failed: {reg_resp.text}"
    id_token = reg_resp.json()["id_token"]
    uid = reg_resp.json()["uid"]

    # 2. Exchange for Tavern Token
    v_resp = await client.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token})
    assert v_resp.status_code == 200, f"Token verification failed: {v_resp.text}"
    token = v_resp.json()["token"]
    
    # 3. Users Self-Registration (Hydration)
    user_resp = await client.post(
        f"{USERS_URL}/users/",
        headers={"Authorization": f"Bearer {token}"},
        json={"email": email, "user_type": "user"}
    )
    assert user_resp.status_code == 201, f"User hydration failed: {user_resp.text}"
    
    return {"token": token, "uid": uid, "email": email}

async def create_profile(client: httpx.AsyncClient, token: str, display_name: str):
    """Utility to create a profile for a user."""
    resp = await client.post(
        f"{PROFILES_URL}/profiles/",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "display_name": display_name,
            "bio": f"Profile for {display_name}",
            "gender": "Other"
        }
    )
    assert resp.status_code == 201, f"Profile creation failed: {resp.text}"
    return resp.json()["profile_id"]
