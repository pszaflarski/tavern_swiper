import pytest
import httpx
import uuid
from helpers import get_root_admin, BOTS_URL, AUTH_URL

@pytest.fixture
async def root_admin():
    async with httpx.AsyncClient() as client:
        return await get_root_admin(client)

@pytest.mark.asyncio
async def test_bot_registration_and_creds_flow(root_admin):
    """
    Test the full bot lifecycle:
    1. Register a bot
    2. Attempt to register same bot (should 409)
    3. Retrieve bot credentials
    4. Verify the credentials actually work by logging in
    """
    slug = f"testbot-{uuid.uuid4().hex[:6]}"
    
    async with httpx.AsyncClient() as client:
        # 1. Register Bot
        reg_payload = {"slug": slug, "display_name": "Test Bot"}
        reg_resp = await client.post(
            f"{BOTS_URL}/bots/",
            headers={"Authorization": f"Bearer {root_admin['token']}"},
            json=reg_payload
        )
        assert reg_resp.status_code == 201, f"Bot registration failed: {reg_resp.text}"
        bot_data = reg_resp.json()
        bot_id = bot_data["bot_id"]
        assert bot_data["slug"] == slug
        assert "bot-" in bot_data["email"]

        # 2. Duplicate Registration (Should 409)
        reg_dup = await client.post(
            f"{BOTS_URL}/bots/",
            headers={"Authorization": f"Bearer {root_admin['token']}"},
            json=reg_payload
        )
        assert reg_dup.status_code == 409, f"Expected 409 for duplicate slug, got: {reg_dup.status_code}"

        # 3. Retrieve Credentials
        creds_resp = await client.post(
            f"{BOTS_URL}/bots/{bot_id}/creds",
            headers={"Authorization": f"Bearer {root_admin['token']}"}
        )
        assert creds_resp.status_code == 200, f"Failed to get bot creds: {creds_resp.text}"
        creds = creds_resp.json()
        
        email = creds["email"]
        password = creds["password"]
        assert email == bot_data["email"]
        assert password is not None

        # 4. Verify Credentials Login Works
        login_resp = await client.post(
            f"{AUTH_URL}/auth/login",
            json={"email": email, "password": password}
        )
        assert login_resp.status_code == 200, f"Bot login with returned creds failed: {login_resp.text}"
        login_data = login_resp.json()
        assert "id_token" in login_data
        assert login_data["uid"] == bot_data["firebase_uid"]
