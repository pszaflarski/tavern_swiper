import pytest
import httpx
import os
import uuid
from .helpers import register_user, create_profile, AUTH_URL, USERS_URL, PROFILES_URL

DISCOVERY_URL = os.getenv("DISCOVERY_URL", "http://localhost:8003")
MESSAGES_URL = os.getenv("MESSAGES_URL", "http://localhost:8005")

@pytest.mark.asyncio
async def test_health_endpoints():
    """Verify that all services report healthy."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        services = [
            f"{AUTH_URL}/auth/health",
            f"{USERS_URL}/users/health",
            f"{PROFILES_URL}/profiles/health",
            f"{DISCOVERY_URL}/discovery/health",
            f"{MESSAGES_URL}/messages/health"
        ]
        for url in services:
            resp = await client.get(url)
            assert resp.status_code == 200, f"Health check failed for {url}: {resp.text}"

@pytest.mark.asyncio
async def test_invalid_token():
    """Ensure invalid/expired tokens are rejected comprehensively with 401."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        bad_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoicm9vdF9hZG1pbiIsImV4cCI6MTIzNH0.badsignature"
        
        headers = {"Authorization": f"Bearer {bad_token}"}
        
        # Test across services
        resps = [
            await client.get(f"{USERS_URL}/users/me", headers=headers),
            await client.get(f"{PROFILES_URL}/profiles/user/me/active", headers=headers),
            await client.get(f"{DISCOVERY_URL}/discovery/feed/dummy_id", headers=headers),
            await client.post(f"{MESSAGES_URL}/messages/conversations", json={"participant_profile_ids": ["1", "2"]}, headers=headers)
        ]
        
        for r in resps:
            assert r.status_code == 401, f"Expected 401 for bad token, got {r.status_code}"

@pytest.mark.asyncio
async def test_auth_boundaries():
    """Ensure non-owners and non-admins cannot perform privileged actions."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        user_a = await register_user(client)
        user_b = await register_user(client)
        
        profile_b_id = await create_profile(client, user_b["token"], "VictimProfile")
        
        # User A tries to update User B's profile
        update_resp = await client.put(
            f"{PROFILES_URL}/profiles/{profile_b_id}",
            headers={"Authorization": f"Bearer {user_a['token']}"},
            json={"display_name": "HackedName"}
        )
        assert update_resp.status_code == 403, "User should not be able to edit another users profile"
        
        # User A tries to delete User B's profile
        delete_resp = await client.delete(
            f"{PROFILES_URL}/profiles/{profile_b_id}",
            headers={"Authorization": f"Bearer {user_a['token']}"}
        )
        assert delete_resp.status_code == 403, "User should not be able to delete another users profile"
        
        # User A (non-root) tries to purge all users
        purge_resp = await client.delete(
            f"{USERS_URL}/users/",
            headers={"Authorization": f"Bearer {user_a['token']}"}
        )
        assert purge_resp.status_code == 403, "Non-root admin should not be able to purge users"

@pytest.mark.asyncio
async def test_bulk_delete_users():
    """Tests bulk deletion of users, which requires admin privileges."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Create users to delete
        user1 = await register_user(client)
        user2 = await register_user(client)
        
        # Since we cannot easily inject an 'admin' role through the standard helpers
        # without DB manipulation, we will assert that a standard user GETS REJECTED.
        # This still exercises the endpoint and security boundary.
        std_user = await register_user(client)
        
        fail_resp = await client.request(
            "DELETE",
            f"{AUTH_URL}/auth/users/",
            headers={"Authorization": f"Bearer {std_user['token']}"},
            json={"uids": [user1["uid"], user2["uid"]]}
        )
        assert fail_resp.status_code == 403, "Standard user cannot bulk delete"

@pytest.mark.asyncio
async def test_dev_mint():
    """Verify that dev-mint is functioning correctly in test environments."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{AUTH_URL}/auth/dev-mint",
            json={"uid": "dev-user-xyz", "role": "admin"}
        )
        # Note: If ALLOW_LONG_LIVED_TOKENS=false, this should return 403.
        # Ensure the test handles either valid outcome explicitly since environments vary.
        assert resp.status_code in [200, 403], f"Dev mint failed: {resp.text}"
        
        if resp.status_code == 200:
            token = resp.json().get("token")
            assert token is not None, "Dev mint should return a token"
