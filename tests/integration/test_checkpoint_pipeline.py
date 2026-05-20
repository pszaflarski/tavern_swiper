"""
Integration tests for the checkpoint-based quest completion pipeline.

Tests the full end-to-end flow against deployed services:
1. Create a test quest with multiple checkpoints via direct Firestore writes
2. Verify the by-bot endpoint returns merged checkpoint + status data
3. Complete checkpoints one at a time using the quests API
4. Verify quest advances through started → completed states
5. Verify rewards are granted only when all checkpoints are done
6. Verify duplicate checkpoint completion returns 409
7. Clean up test data after each test

These tests do NOT use an LLM — they simulate what the agent_router tools
would do by calling the quests service HTTP endpoints directly.
"""

import pytest
import httpx
import jwt
import uuid
import os
import time
import datetime
from google.cloud import firestore
from .helpers import get_root_admin, register_user, create_profile, QUESTS_URL


# --- Configuration ---
FIRESTORE_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
QUESTS_DB = os.getenv("QUESTS_DB", "quests-dev")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_db():
    """Get a Firestore client for the quests database."""
    return firestore.Client(project=FIRESTORE_PROJECT, database=QUESTS_DB)


def _mint_bot_token(bot_uid: str = "checkpoint-test-bot") -> str:
    """Mint a bot JWT for testing (same as agent_router tools)."""
    secret = os.getenv("JWT_SECRET", "")
    assert secret, "JWT_SECRET must be set in test environment"
    now = int(time.time())
    payload = {
        "sub": bot_uid,
        "role": "bot",
        "iat": now,
        "exp": now + 300,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def _seed_test_quest(quest_id: str, title: str, rewards: list[dict]):
    """Seed a quest template directly in Firestore."""
    db = _get_db()
    now = datetime.datetime.now(datetime.timezone.utc)
    db.collection("quest_templates").document(quest_id).set({
        "quest_id": quest_id,
        "title": title,
        "description": f"Integration test quest: {title}",
        "quest_type": "story",
        "status": "active",
        "sort_order": 99,
        "rewards": rewards,
        "metadata": {},
        "created_at": now,
        "updated_at": now,
    })
    print(f"  📜 Seeded quest template: {title} ({quest_id})")


def _seed_checkpoint(checkpoint_id: str, quest_id: str, bot_id: str,
                     description: str, detailed_description: str,
                     success_criteria: str, sort_order: int):
    """Seed a checkpoint template directly in Firestore."""
    db = _get_db()
    now = datetime.datetime.now(datetime.timezone.utc)
    db.collection("checkpoint_templates").document(checkpoint_id).set({
        "checkpoint_id": checkpoint_id,
        "quest_id": quest_id,
        "bot_id": bot_id,
        "description": description,
        "detailed_description": detailed_description,
        "success_criteria": success_criteria,
        "sort_order": sort_order,
        "created_at": now,
        "updated_at": now,
    })
    print(f"    🔲 Seeded checkpoint: {description} ({checkpoint_id})")


def _cleanup_test_data(quest_id: str, checkpoint_ids: list[str], user_id: str,
                       item_ids: list[str] = None):
    """Clean up all test data from Firestore."""
    db = _get_db()

    # Delete quest template
    db.collection("quest_templates").document(quest_id).delete()

    # Delete checkpoint templates
    for cp_id in checkpoint_ids:
        db.collection("checkpoint_templates").document(cp_id).delete()

    # Delete quest status
    status_doc_id = f"quest_{quest_id}_{user_id}"
    db.collection("quest_status").document(status_doc_id).delete()

    # Delete checkpoint statuses
    for cp_id in checkpoint_ids:
        cs_doc_id = f"cpstatus_{quest_id}_{cp_id}_{user_id}"
        db.collection("checkpoint_status").document(cs_doc_id).delete()

    # Delete inventory entries
    for item_id in (item_ids or []):
        inv_doc_id = f"inv_{user_id}_{item_id}"
        db.collection("user_inventory").document(inv_doc_id).delete()

    print(f"  🧹 Cleaned up test data for quest {quest_id}")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
async def admin_context():
    """Fixture: root admin token."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        return await get_root_admin(client)


@pytest.fixture(scope="module")
async def test_user_with_profile():
    """Fixture: register a test user and create a profile."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        user = await register_user(client)
        profile_id = await create_profile(client, user["token"], "Checkpoint Tester")
        return {**user, "profile_id": profile_id}


# ---------------------------------------------------------------------------
# Test: by-bot endpoint returns merged checkpoint data
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_by_bot_endpoint_returns_checkpoints(test_user_with_profile):
    """
    The GET /quests/checkpoints/by-bot/:bot_id endpoint should return
    checkpoint templates merged with quest info and completion status.
    """
    quest_id = f"itest_bybot_{uuid.uuid4().hex[:6]}"
    cp_id = f"itest_cp_{uuid.uuid4().hex[:6]}"
    bot_id = "itest_bot"
    user = test_user_with_profile

    try:
        # Seed test data
        _seed_test_quest(quest_id, "By-Bot Integration Test", [
            {"item_id": "gold", "quantity": 100}
        ])
        _seed_checkpoint(
            cp_id, quest_id, bot_id,
            description="Talk to the bot",
            detailed_description="Walk up and say hello to the test bot.",
            success_criteria="The user has sent at least one message.",
            sort_order=1,
        )

        # Call the by-bot endpoint with a bot JWT
        bot_token = _mint_bot_token()
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{QUESTS_URL}/quests/checkpoints/by-bot/{bot_id}",
                params={"profile_id": user["profile_id"]},
                headers={"Authorization": f"Bearer {bot_token}"},
            )

            assert resp.status_code == 200, f"by-bot endpoint failed: {resp.text}"
            views = resp.json()

            # Find our test checkpoint
            our_cp = next((v for v in views if v["checkpoint_id"] == cp_id), None)
            assert our_cp is not None, (
                f"Test checkpoint {cp_id} not found in by-bot response. "
                f"Got: {[v['checkpoint_id'] for v in views]}"
            )

            # Verify all fields are present
            assert our_cp["quest_id"] == quest_id
            assert our_cp["quest_title"] == "By-Bot Integration Test"
            assert our_cp["description"] == "Talk to the bot"
            assert our_cp["detailed_description"] == "Walk up and say hello to the test bot."
            assert our_cp["success_criteria"] == "The user has sent at least one message."
            assert our_cp["status"] == "not_completed"
            assert our_cp["quest_status"] == "not_started"
            assert len(our_cp["quest_rewards"]) == 1
            assert our_cp["quest_rewards"][0]["item_id"] == "gold"
            print(f"\n✅ by-bot endpoint returned all fields correctly for {cp_id}")

    finally:
        _cleanup_test_data(quest_id, [cp_id], user["uid"], ["gold"])


# ---------------------------------------------------------------------------
# Test: by-bot rejects non-bot users
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_by_bot_endpoint_rejects_regular_user(test_user_with_profile):
    """Regular users should get 403 from the by-bot endpoint."""
    user = test_user_with_profile

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{QUESTS_URL}/quests/checkpoints/by-bot/any_bot",
            params={"profile_id": user["profile_id"]},
            headers={"Authorization": f"Bearer {user['token']}"},
        )
        assert resp.status_code == 403, f"Expected 403 for regular user, got {resp.status_code}"
        print(f"\n🚫 by-bot endpoint correctly rejected regular user: {resp.status_code}")


# ---------------------------------------------------------------------------
# Test: Single checkpoint → quest completes → rewards granted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_single_checkpoint_quest_completion(test_user_with_profile, admin_context):
    """
    Full pipeline: 1 checkpoint quest → complete checkpoint → quest completes → reward.

    Simulates the exact flow that agent_router tools would perform:
    1. Bot calls get_my_checkpoints (by-bot endpoint)
    2. LLM evaluates success_criteria (we skip this — it's the LLM's job)
    3. Bot calls complete_checkpoint (POST /quests/status/by-profile/)
    4. Verify quest completed and rewards granted
    """
    quest_id = f"itest_single_{uuid.uuid4().hex[:6]}"
    cp_id = f"itest_scp_{uuid.uuid4().hex[:6]}"
    bot_id = "itest_single_bot"
    reward_item = f"itest_gem_{uuid.uuid4().hex[:4]}"
    user = test_user_with_profile

    try:
        # Seed: quest with 1 checkpoint and 1 reward
        _seed_test_quest(quest_id, "Single CP Test", [
            {"item_id": reward_item, "quantity": 3}
        ])
        _seed_checkpoint(
            cp_id, quest_id, bot_id,
            description="Say hello",
            detailed_description="Greet the barkeep",
            success_criteria="User sent a message",
            sort_order=1,
        )

        # Seed the reward item definition so granting works
        db = _get_db()
        db.collection("item_definitions").document(reward_item).set({
            "name": "Test Gem",
            "description": "Integration test reward",
            "category": "collectible",
            "rarity": "common",
            "max_stack": 0,
        })

        bot_token = _mint_bot_token()
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Step 1: Check by-bot — should show 1 uncompleted checkpoint
            resp1 = await client.get(
                f"{QUESTS_URL}/quests/checkpoints/by-bot/{bot_id}",
                params={"profile_id": user["profile_id"]},
                headers={"Authorization": f"Bearer {bot_token}"},
            )
            assert resp1.status_code == 200
            views = resp1.json()
            our_cp = next((v for v in views if v["checkpoint_id"] == cp_id), None)
            assert our_cp is not None
            assert our_cp["status"] == "not_completed"
            print(f"\n📋 Step 1: Checkpoint {cp_id} is NOT COMPLETED")

            # Step 2: Complete the quest (simulating complete_checkpoint tool)
            resp2 = await client.post(
                f"{QUESTS_URL}/quests/status/by-profile/",
                headers={
                    "Authorization": f"Bearer {bot_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "quest_id": quest_id,
                    "profile_id": user["profile_id"],
                    "status": "completed",
                },
            )
            assert resp2.status_code == 200, f"Quest completion failed: {resp2.text}"
            result = resp2.json()
            assert result["status"] == "completed"
            print(f"   ✅ Step 2: Quest completed: {result['status']}")

            # Step 3: Verify by-bot now shows completed
            resp3 = await client.get(
                f"{QUESTS_URL}/quests/checkpoints/by-bot/{bot_id}",
                params={"profile_id": user["profile_id"]},
                headers={"Authorization": f"Bearer {bot_token}"},
            )
            views3 = resp3.json()
            our_cp3 = next((v for v in views3 if v["checkpoint_id"] == cp_id), None)
            assert our_cp3 is not None
            assert our_cp3["status"] == "completed"
            assert our_cp3["quest_status"] == "completed"
            print(f"   ✅ Step 3: Checkpoint now shows COMPLETED")

            # Step 4: Verify inventory has the reward
            inv_resp = await client.get(
                f"{QUESTS_URL}/quests/inventory/{user['uid']}",
                headers={"Authorization": f"Bearer {user['token']}"},
            )
            assert inv_resp.status_code == 200
            inventory = inv_resp.json()
            gem_entry = next((e for e in inventory if e["item_id"] == reward_item), None)
            assert gem_entry is not None, (
                f"Reward '{reward_item}' not in inventory. "
                f"Got: {[e['item_id'] for e in inventory]}"
            )
            assert gem_entry["quantity"] >= 3
            print(f"   💎 Step 4: Reward granted: {gem_entry['quantity']}x {reward_item}")

    finally:
        # Also clean up item definition
        db = _get_db()
        db.collection("item_definitions").document(reward_item).delete()
        _cleanup_test_data(quest_id, [cp_id], user["uid"], [reward_item])


# ---------------------------------------------------------------------------
# Test: Multi-checkpoint quest advances one at a time
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_multi_checkpoint_advances_one_at_a_time(test_user_with_profile):
    """
    Quest with 3 checkpoints: completing via by-profile should advance
    through started → started → completed as checkpoints are done.
    """
    quest_id = f"itest_multi_{uuid.uuid4().hex[:6]}"
    cp1_id = f"itest_mcp1_{uuid.uuid4().hex[:6]}"
    cp2_id = f"itest_mcp2_{uuid.uuid4().hex[:6]}"
    cp3_id = f"itest_mcp3_{uuid.uuid4().hex[:6]}"
    bot_id = "itest_multi_bot"
    user = test_user_with_profile

    try:
        # Seed: quest with 3 checkpoints, no rewards (simpler)
        _seed_test_quest(quest_id, "Multi CP Test", [])
        _seed_checkpoint(cp1_id, quest_id, bot_id, "Step 1", "Do step 1",
                         "User did step 1", sort_order=1)
        _seed_checkpoint(cp2_id, quest_id, bot_id, "Step 2", "Do step 2",
                         "User did step 2", sort_order=2)
        _seed_checkpoint(cp3_id, quest_id, bot_id, "Step 3", "Do step 3",
                         "User did step 3", sort_order=3)

        bot_token = _mint_bot_token()
        async with httpx.AsyncClient(timeout=30.0) as client:

            # --- First completion: should return "started" ---
            resp1 = await client.post(
                f"{QUESTS_URL}/quests/status/by-profile/",
                headers={
                    "Authorization": f"Bearer {bot_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "quest_id": quest_id,
                    "profile_id": user["profile_id"],
                    "status": "completed",
                },
            )
            assert resp1.status_code == 200, f"First completion failed: {resp1.text}"
            r1 = resp1.json()
            assert r1["status"] == "started", (
                f"Expected 'started' after 1/3 checkpoints, got '{r1['status']}'"
            )
            print(f"\n📋 Turn 1: Quest status = {r1['status']} (1/3 done)")

            # Verify by-bot shows 1 completed, 2 uncompleted
            bybot1 = await client.get(
                f"{QUESTS_URL}/quests/checkpoints/by-bot/{bot_id}",
                params={"profile_id": user["profile_id"]},
                headers={"Authorization": f"Bearer {bot_token}"},
            )
            views1 = bybot1.json()
            completed1 = [v for v in views1 if v["status"] == "completed" and v["quest_id"] == quest_id]
            uncompleted1 = [v for v in views1 if v["status"] == "not_completed" and v["quest_id"] == quest_id]
            assert len(completed1) == 1, f"Expected 1 completed, got {len(completed1)}"
            assert len(uncompleted1) == 2, f"Expected 2 uncompleted, got {len(uncompleted1)}"
            print(f"   ✅ by-bot: {len(completed1)} completed, {len(uncompleted1)} remaining")

            # --- Second completion: still "started" ---
            resp2 = await client.post(
                f"{QUESTS_URL}/quests/status/by-profile/",
                headers={
                    "Authorization": f"Bearer {bot_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "quest_id": quest_id,
                    "profile_id": user["profile_id"],
                    "status": "completed",
                },
            )
            assert resp2.status_code == 200, f"Second completion failed: {resp2.text}"
            r2 = resp2.json()
            assert r2["status"] == "started", (
                f"Expected 'started' after 2/3 checkpoints, got '{r2['status']}'"
            )
            print(f"   📋 Turn 2: Quest status = {r2['status']} (2/3 done)")

            # --- Third completion: should return "completed" ---
            resp3 = await client.post(
                f"{QUESTS_URL}/quests/status/by-profile/",
                headers={
                    "Authorization": f"Bearer {bot_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "quest_id": quest_id,
                    "profile_id": user["profile_id"],
                    "status": "completed",
                },
            )
            assert resp3.status_code == 200, f"Third completion failed: {resp3.text}"
            r3 = resp3.json()
            assert r3["status"] == "completed", (
                f"Expected 'completed' after 3/3 checkpoints, got '{r3['status']}'"
            )
            print(f"   🏆 Turn 3: Quest status = {r3['status']} (ALL DONE)")

            # --- Fourth attempt: should return 409 ---
            resp4 = await client.post(
                f"{QUESTS_URL}/quests/status/by-profile/",
                headers={
                    "Authorization": f"Bearer {bot_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "quest_id": quest_id,
                    "profile_id": user["profile_id"],
                    "status": "completed",
                },
            )
            assert resp4.status_code == 409, (
                f"Expected 409 for already-completed quest, got {resp4.status_code}: {resp4.text}"
            )
            print(f"   🚫 Turn 4: Duplicate rejected: {resp4.status_code}")

    finally:
        _cleanup_test_data(quest_id, [cp1_id, cp2_id, cp3_id], user["uid"])


# ---------------------------------------------------------------------------
# Test: by-bot returns empty for unknown bot
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_by_bot_returns_empty_for_unknown_bot(test_user_with_profile):
    """Querying checkpoints for a bot with no assignments returns []."""
    user = test_user_with_profile
    bot_token = _mint_bot_token()

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{QUESTS_URL}/quests/checkpoints/by-bot/nonexistent_bot_{uuid.uuid4().hex[:6]}",
            params={"profile_id": user["profile_id"]},
            headers={"Authorization": f"Bearer {bot_token}"},
        )
        assert resp.status_code == 200
        assert resp.json() == []
        print(f"\n✅ by-bot correctly returns empty for unknown bot")
