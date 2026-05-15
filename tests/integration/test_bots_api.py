import pytest
import httpx
import uuid
from .helpers import get_root_admin, BOTS_URL, AUTH_URL, USERS_URL

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

        # 5. Verify the bot's user record has user_type 'bot'
        # Exchange the bot's id_token for a Tavern JWT to query /users/me
        verify_resp = await client.post(
            f"{AUTH_URL}/auth/verify",
            json={"id_token": login_data["id_token"]}
        )
        assert verify_resp.status_code == 200, f"Bot verify failed: {verify_resp.text}"
        bot_token = verify_resp.json()["token"]

        me_resp = await client.get(
            f"{USERS_URL}/users/me",
            headers={"Authorization": f"Bearer {bot_token}"}
        )
        assert me_resp.status_code == 200, f"Failed to get bot user record: {me_resp.text}"
        user_record = me_resp.json()
        assert user_record["user_type"] == "bot", (
            f"Expected user_type 'bot', got '{user_record['user_type']}'"
        )

@pytest.mark.asyncio
async def test_bot_profile_creation_with_image(root_admin):
    """
    Test the bot profile creation endpoint:
    1. Register a bot
    2. Create a profile for the bot using POST /bots/:id/profile with an image link
    3. Verify the profile is created and image is processed
    """
    slug = f"profbot-{uuid.uuid4().hex[:6]}"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Register Bot
        reg_payload = {"slug": slug, "display_name": "Profile Bot"}
        reg_resp = await client.post(
            f"{BOTS_URL}/bots/",
            headers={"Authorization": f"Bearer {root_admin['token']}"},
            json=reg_payload
        )
        assert reg_resp.status_code == 201, f"Bot registration failed: {reg_resp.text}"
        bot_id = reg_resp.json()["bot_id"]

        # 2. Create Profile with Image Link
        # Use a public PNG to prove the bots service converts any format to JPEG
        public_image_url = "https://httpbin.org/image/png"
        
        profile_payload = {
            "display_name": "Profile Bot's Real Name",
            "bio": "I am a bot with an image.",
            "tagline": "Beep boop",
            "image_links": [public_image_url],
            "gender": [],
            "race": [],
            "fandom": [],
            "interests": [],
            "events": [],
            "looking_for": []
        }
        
        prof_resp = await client.post(
            f"{BOTS_URL}/bots/{bot_id}/profile",
            headers={"Authorization": f"Bearer {root_admin['token']}"},
            json=profile_payload
        )
        assert prof_resp.status_code == 201, f"Bot profile creation failed: {prof_resp.text}"
        
        profile_data = prof_resp.json()
        assert profile_data["display_name"] == "Profile Bot's Real Name"
        
        # Verify the image was downloaded and uploaded (should have a GCS URL now)
        assert "image_urls" in profile_data
        assert len(profile_data["image_urls"]) > 0
        assert "storage.googleapis.com" in profile_data["image_urls"][0]
        
        # Verify bot_profile was created and linked correctly
        assert "bot_profile_id" in profile_data, "Response should include bot_profile_id"
        
        # Verify via GET /bots/:id that profiles are tracked
        bot_resp = await client.get(
            f"{BOTS_URL}/bots/{bot_id}",
            headers={"Authorization": f"Bearer {root_admin['token']}"}
        )
        assert bot_resp.status_code == 200
        bot_detail = bot_resp.json()
        assert "bot" in bot_detail
        assert "profiles" in bot_detail
        assert len(bot_detail["profiles"]) == 1
        assert bot_detail["profiles"][0]["profile_id"] == profile_data["profile_id"]

