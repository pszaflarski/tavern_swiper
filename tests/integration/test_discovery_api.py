import pytest
import httpx
import os
import asyncio
from .helpers import register_user, create_profile

DISCOVERY_URL = os.getenv("DISCOVERY_URL", "http://localhost:8003")
@pytest.mark.asyncio
async def test_match_retrieval():
    """Verify that matches can be fetched directly via their ID and by profile."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Create user A
        user_a = await register_user(client)
        pid_a = await create_profile(client, user_a["token"], "MatcherA")
        
        # Create user B
        user_b = await register_user(client)
        pid_b = await create_profile(client, user_b["token"], "MatcherB")
        
        # Give discovery time to cache profiles via pubsub
        await asyncio.sleep(4)
        
        # A swipes right on B
        resp_a = await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {user_a['token']}"},
            json={
                "swiper_profile_id": pid_a,
                "swiped_profile_id": pid_b,
                "direction": "right"
            }
        )
        assert resp_a.status_code == 201
        
        # B swipes right on A
        resp_b = await client.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {user_b['token']}"},
            json={
                "swiper_profile_id": pid_b,
                "swiped_profile_id": pid_a,
                "direction": "right"
            }
        )
        assert resp_b.status_code == 201
        res_data = resp_b.json()
        assert res_data.get("match_id") is not None, f"Expected a match_id in response but got: {res_data}"
        match_id = res_data["match_id"]
        
        # 1. Fetch match by ID using user_a credentials
        resp_match = await client.get(
            f"{DISCOVERY_URL}/discovery/matches/{match_id}",
            headers={"Authorization": f"Bearer {user_a['token']}"}
        )
        assert resp_match.status_code == 200
        match_data = resp_match.json()
        assert match_data["id"] == match_id
        assert pid_a in match_data["profiles"]
        assert pid_b in match_data["profiles"]
        
        # 2. Fetch matches for profile
        resp_list = await client.get(
            f"{DISCOVERY_URL}/discovery/matches/profile/{pid_a}",
            headers={"Authorization": f"Bearer {user_a['token']}"}
        )
        assert resp_list.status_code == 200
        list_data = resp_list.json()
        assert isinstance(list_data, list)
        assert len(list_data) >= 1
        
        found = False
        for m in list_data:
            if m["id"] == match_id:
                found = True
                break
        assert found, "Match was not found in profile matches list"
