"""
Integration tests for quest rewards and the OI YA GIT greeting quest.

Tests:
1. Completing 'meet_the_tavern_keepers' quest grants 500 gold
2. Completing 'oi_ya_git' quest (Grogmar's greeting) grants 1x D6 die
3. Duplicate completion is rejected (409)
4. Rewards are visible in the user's inventory
5. Bot-minted JWT (Grogmar's tool code path) completes quests successfully
"""

import pytest
import httpx
import jwt
import uuid
import os
import time
import asyncio
from google.cloud import firestore
from .helpers import get_root_admin, register_user, QUESTS_URL


# --- Configuration ---
FIRESTORE_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "tavern-swiper-dev")
QUESTS_DB = os.getenv("QUESTS_DB", "quests-dev")


@pytest.fixture(scope="module")
async def admin_context():
    """Fixture: root admin token."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        return await get_root_admin(client)


@pytest.fixture(scope="module")
async def test_user():
    """Fixture: register a test user for quest tests."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        return await register_user(client)


def ensure_quest_template(quest_id: str, title: str, rewards: list[dict]):
    """Ensure a quest template exists in Firestore (seed if missing)."""
    import datetime

    db = firestore.Client(project=FIRESTORE_PROJECT, database=QUESTS_DB)
    doc_ref = db.collection("quest_templates").document(quest_id)
    doc = doc_ref.get()

    if not doc.exists:
        now = datetime.datetime.now(datetime.timezone.utc)
        doc_ref.set({
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
    else:
        print(f"  📜 Quest template already exists: {quest_id}")


def clear_user_quest_and_inventory(user_id: str, quest_id: str, item_id: str):
    """Clean up quest status and inventory for a user before tests."""
    db = firestore.Client(project=FIRESTORE_PROJECT, database=QUESTS_DB)

    # Clear quest status
    status_doc_id = f"quest_{quest_id}_{user_id}"
    db.collection("quest_status").document(status_doc_id).delete()

    # Clear inventory entry
    inv_doc_id = f"inv_{user_id}_{item_id}"
    db.collection("user_inventory").document(inv_doc_id).delete()


# =============================================================================
# Test: Meet the Tavern Keepers → 500 gold
# =============================================================================


@pytest.mark.asyncio
async def test_meet_tavern_keepers_grants_gold(admin_context, test_user):
    """
    Completing 'meet_the_tavern_keepers' quest should grant 500 gold.

    Flow:
    1. Ensure quest template exists with rewards: [{item_id: gold, quantity: 500}]
    2. Admin completes the quest for the test user
    3. Verify quest status is 'completed'
    4. Verify user's inventory now contains gold with quantity >= 500
    """
    quest_id = "meet_the_tavern_keepers"
    reward_item = "gold"
    reward_qty = 500

    # Setup
    ensure_quest_template(quest_id, "Meet the Tavern Keepers", [
        {"item_id": reward_item, "quantity": reward_qty}
    ])
    clear_user_quest_and_inventory(test_user["uid"], quest_id, reward_item)

    headers = {"Authorization": f"Bearer {admin_context['token']}"}
    profile_id = f"test-profile-{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Complete the quest
        print(f"\n⚔️  Completing quest '{quest_id}' for user {test_user['uid']}")
        resp = await client.post(
            f"{QUESTS_URL}/quests/status/",
            headers=headers,
            json={
                "quest_id": quest_id,
                "user_id": test_user["uid"],
                "profile_id": profile_id,
                "status": "completed",
            },
        )
        assert resp.status_code == 200, f"Quest completion failed: {resp.text}"
        quest_status = resp.json()
        assert quest_status["status"] == "completed"
        print(f"   ✅ Quest status: {quest_status['status']}")

        # 2. Check inventory for gold reward
        inv_resp = await client.get(
            f"{QUESTS_URL}/quests/inventory/{test_user['uid']}",
            headers={"Authorization": f"Bearer {test_user['token']}"},
        )
        assert inv_resp.status_code == 200, f"Inventory fetch failed: {inv_resp.text}"

        inventory = inv_resp.json()
        gold_entry = next((e for e in inventory if e["item_id"] == reward_item), None)
        assert gold_entry is not None, (
            f"Gold not found in inventory after quest completion. "
            f"Inventory: {[e['item_id'] for e in inventory]}"
        )
        assert gold_entry["quantity"] >= reward_qty, (
            f"Expected at least {reward_qty} gold, got {gold_entry['quantity']}"
        )
        print(f"   💰 Gold in inventory: {gold_entry['quantity']}")


# =============================================================================
# Test: OI YA GIT → 1x D6 die
# =============================================================================


@pytest.mark.asyncio
async def test_oi_ya_git_grants_d6(admin_context, test_user):
    """
    Completing 'oi_ya_git' quest should grant 1x dice_d6.

    This simulates what Grogmar's tool does when he greets a new adventurer.
    """
    quest_id = "oi_ya_git"
    reward_item = "dice_d6"
    reward_qty = 1

    # Setup
    ensure_quest_template(quest_id, "OI YA GIT!", [
        {"item_id": reward_item, "quantity": reward_qty}
    ])
    clear_user_quest_and_inventory(test_user["uid"], quest_id, reward_item)

    headers = {"Authorization": f"Bearer {admin_context['token']}"}
    profile_id = f"grogmar-profile-{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Complete the quest (simulating Grogmar's tool call)
        print(f"\n🟢 Completing quest '{quest_id}' for user {test_user['uid']}")
        resp = await client.post(
            f"{QUESTS_URL}/quests/status/",
            headers=headers,
            json={
                "quest_id": quest_id,
                "user_id": test_user["uid"],
                "profile_id": profile_id,
                "status": "completed",
            },
        )
        assert resp.status_code == 200, f"Quest completion failed: {resp.text}"
        quest_status = resp.json()
        assert quest_status["status"] == "completed"
        print(f"   ✅ Quest status: {quest_status['status']}")

        # 2. Check inventory for D6 reward
        inv_resp = await client.get(
            f"{QUESTS_URL}/quests/inventory/{test_user['uid']}",
            headers={"Authorization": f"Bearer {test_user['token']}"},
        )
        assert inv_resp.status_code == 200, f"Inventory fetch failed: {inv_resp.text}"

        inventory = inv_resp.json()
        d6_entry = next((e for e in inventory if e["item_id"] == reward_item), None)
        assert d6_entry is not None, (
            f"dice_d6 not found in inventory after OI YA GIT quest completion. "
            f"Inventory: {[e['item_id'] for e in inventory]}"
        )
        assert d6_entry["quantity"] >= reward_qty, (
            f"Expected at least {reward_qty} dice_d6, got {d6_entry['quantity']}"
        )
        print(f"   🎲 D6 in inventory: {d6_entry['quantity']}")


# =============================================================================
# Test: Duplicate completion is rejected
# =============================================================================


@pytest.mark.asyncio
async def test_duplicate_quest_completion_rejected(admin_context, test_user):
    """
    Attempting to complete the same quest twice should return 409 Conflict.
    """
    quest_id = "oi_ya_git"
    reward_item = "dice_d6"

    # Setup — ensure quest exists and is clean
    ensure_quest_template(quest_id, "OI YA GIT!", [
        {"item_id": reward_item, "quantity": 1}
    ])
    clear_user_quest_and_inventory(test_user["uid"], quest_id, reward_item)

    headers = {"Authorization": f"Bearer {admin_context['token']}"}
    profile_id = f"grogmar-profile-{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. First completion — should succeed
        resp1 = await client.post(
            f"{QUESTS_URL}/quests/status/",
            headers=headers,
            json={
                "quest_id": quest_id,
                "user_id": test_user["uid"],
                "profile_id": profile_id,
                "status": "completed",
            },
        )
        assert resp1.status_code == 200, f"First completion failed: {resp1.text}"
        print(f"\n🔄 First completion: {resp1.json()['status']}")

        # 2. Second completion (same profile) — should return 409
        resp2 = await client.post(
            f"{QUESTS_URL}/quests/status/",
            headers=headers,
            json={
                "quest_id": quest_id,
                "user_id": test_user["uid"],
                "profile_id": profile_id,
                "status": "completed",
            },
        )
        assert resp2.status_code == 409, (
            f"Expected 409 for duplicate completion, got {resp2.status_code}: {resp2.text}"
        )
        print(f"   🚫 Second completion correctly rejected: {resp2.status_code}")

        # 3. Verify inventory wasn't double-granted
        inv_resp = await client.get(
            f"{QUESTS_URL}/quests/inventory/{test_user['uid']}",
            headers={"Authorization": f"Bearer {test_user['token']}"},
        )
        inventory = inv_resp.json()
        d6_entry = next((e for e in inventory if e["item_id"] == reward_item), None)
        assert d6_entry is not None, "D6 should exist from first completion"
        assert d6_entry["quantity"] == 1, (
            f"Expected exactly 1 dice_d6 (no double grant), got {d6_entry['quantity']}"
        )
        print(f"   🎲 D6 quantity confirmed: {d6_entry['quantity']} (no double grant)")


# =============================================================================
# Test: Bot-minted JWT (Grogmar's tool code path)
# =============================================================================


def _mint_bot_token(bot_uid: str = "grogmar-bot") -> str:
    """Mint a bot JWT exactly the way Grogmar's tool does.

    This is a copy of tools/quests.py::_mint_bot_token() so we test
    the same code path without importing from the agent_router package.
    """
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


@pytest.mark.asyncio
async def test_bot_minted_jwt_completes_quest_and_grants_d6(test_user):
    """
    Integration Test: Grogmar's exact tool code path.

    This test exercises the REAL flow that happens when Grogmar's LLM
    invokes the complete_oi_ya_git_quest tool:

    1. Mint a bot JWT using the shared JWT_SECRET (same as _mint_bot_token)
    2. Call POST /quests/status/ with that bot token
    3. Verify the quest completes (not rejected for auth)
    4. Verify the D6 die appears in the user's inventory

    If this test fails, Grogmar's tool will also fail in production.
    """
    quest_id = "oi_ya_git"
    reward_item = "dice_d6"
    reward_qty = 1

    # Setup
    ensure_quest_template(quest_id, "OI YA GIT!", [
        {"item_id": reward_item, "quantity": reward_qty}
    ])
    clear_user_quest_and_inventory(test_user["uid"], quest_id, reward_item)

    # Mint a bot token — this is EXACTLY what Grogmar's tool does
    bot_token = _mint_bot_token("grogmar-bot")
    bot_headers = {
        "Authorization": f"Bearer {bot_token}",
        "Content-Type": "application/json",
    }

    grogmar_profile_id = f"grogmar-profile-{uuid.uuid4().hex[:6]}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Complete quest with bot-minted JWT
        print(f"\n🤖 Grogmar's tool completing quest '{quest_id}' for user {test_user['uid']}")
        resp = await client.post(
            f"{QUESTS_URL}/quests/status/",
            headers=bot_headers,
            json={
                "quest_id": quest_id,
                "user_id": test_user["uid"],
                "profile_id": grogmar_profile_id,
                "status": "completed",
            },
        )
        assert resp.status_code == 200, (
            f"Bot-minted JWT quest completion failed with {resp.status_code}: {resp.text}. "
            f"This means Grogmar's tool would also fail in production!"
        )
        quest_status = resp.json()
        assert quest_status["status"] == "completed"
        print(f"   ✅ Quest completed via bot token: {quest_status['status']}")

        # 2. Verify D6 in inventory (fetch with user's own token)
        inv_resp = await client.get(
            f"{QUESTS_URL}/quests/inventory/{test_user['uid']}",
            headers={"Authorization": f"Bearer {test_user['token']}"},
        )
        assert inv_resp.status_code == 200, f"Inventory fetch failed: {inv_resp.text}"

        inventory = inv_resp.json()
        d6_entry = next((e for e in inventory if e["item_id"] == reward_item), None)
        assert d6_entry is not None, (
            f"dice_d6 NOT found in inventory after bot-token quest completion. "
            f"The grantQuestRewards() function may have failed silently. "
            f"Inventory: {[e['item_id'] for e in inventory]}"
        )
        assert d6_entry["quantity"] >= reward_qty, (
            f"Expected at least {reward_qty} dice_d6, got {d6_entry['quantity']}"
        )
        print(f"   🎲 D6 granted via bot token: {d6_entry['quantity']}")
        print(f"   ✅ Grogmar's tool code path works end-to-end!")
