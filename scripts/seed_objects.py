"""
Seed the item_definitions collection in the quests service.

This script:
1. Connects directly to Firestore (quests-{env}) using ADC
2. Creates (or updates) item definitions with deterministic IDs
3. Idempotent — safe to run multiple times

Usage:
    .venv/bin/python3 scripts/seed_objects.py [dev|test]
"""

import sys
import datetime

from google.cloud import firestore

# ─── Item Definitions ─────────────────────────────────────────────────────────

ITEMS = [
    {
        "item_id": "gold",
        "name": "Gold",
        "description": (
            "The universal currency of the realm. "
            "Earned through quests, wagers, and the goodwill of fellow adventurers."
        ),
        "image_url": "",
        "category": "currency",
        "max_stack": 0,  # unlimited
        "tradeable": True,
        "actions": ["trade", "gift"],
        "metadata": {},
    },
    {
        "item_id": "dice_d4",
        "name": "Standard D4 Dice",
        "description": (
            "A four-sided die carved from enchanted stone. "
            "Favoured by rogues for quick, decisive rolls."
        ),
        "image_url": "",
        "category": "key_item",
        "max_stack": 0,
        "tradeable": False,
        "actions": ["use"],
        "metadata": {"sides": 4, "dice_type": "d4"},
    },
    {
        "item_id": "dice_d6",
        "name": "Standard D6 Dice",
        "description": (
            "The classic six-sided die. "
            "Reliable, sturdy, and the backbone of any adventurer's pouch."
        ),
        "image_url": "",
        "category": "key_item",
        "max_stack": 0,
        "tradeable": True,
        "actions": ["use", "trade", "gift"],
        "metadata": {"sides": 6, "dice_type": "d6"},
    },
    {
        "item_id": "dice_d8",
        "name": "Standard D8 Dice",
        "description": (
            "An eight-sided die humming with faint arcane energy. "
            "A step above the ordinary."
        ),
        "image_url": "",
        "category": "key_item",
        "max_stack": 0,
        "tradeable": False,
        "actions": ["use"],
        "metadata": {"sides": 8, "dice_type": "d8"},
    },
    {
        "item_id": "dice_d12",
        "name": "Standard D12 Dice",
        "description": (
            "A twelve-sided die, rarely seen outside the vaults "
            "of seasoned dungeon-delvers."
        ),
        "image_url": "",
        "category": "key_item",
        "max_stack": 0,
        "tradeable": False,
        "actions": ["use"],
        "metadata": {"sides": 12, "dice_type": "d12"},
    },
    {
        "item_id": "dice_d20",
        "name": "Standard D20 Dice",
        "description": (
            "The legendary twenty-sided die. "
            "Every critical moment deserves one of these."
        ),
        "image_url": "",
        "category": "key_item",
        "max_stack": 0,
        "tradeable": False,
        "actions": ["use"],
        "metadata": {"sides": 20, "dice_type": "d20"},
    },
]

# ─── Quest Templates ──────────────────────────────────────────────────────────

QUESTS = [
    {
        "quest_id": "meet_the_tavern_keepers",
        "title": "Meet the Tavern Keepers",
        "description": (
            "Every adventurer's journey begins at the tavern. "
            "Introduce yourself to the keepers and earn your first purse of gold."
        ),
        "quest_type": "story",
        "status": "active",
        "sort_order": 1,
        "rewards": [
            {"item_id": "gold", "quantity": 500},
        ],
        "metadata": {},
    },
    {
        "quest_id": "oi_ya_git",
        "title": "OI YA GIT!",
        "description": (
            "Walk up to Grogmar's bar and say somefin'. "
            "Da big green lump might even toss ya a bone cube if 'e likes yer face."
        ),
        "quest_type": "story",
        "status": "active",
        "sort_order": 2,
        "rewards": [
            {"item_id": "dice_d6", "quantity": 1},
        ],
        "metadata": {
            "assigned_to": "grogmar",
            "trigger": "first_message",
        },
    },
]

# ─── Main ─────────────────────────────────────────────────────────────────────

def seed_objects(env: str):
    project_id = "tavern-swiper-dev" if env in ("dev", "test") else "tavern-swiper-prod"
    db_id = f"quests-{env}"

    print(f"🎯 Seeding item definitions into {db_id} (project: {project_id})")

    db = firestore.Client(project=project_id, database=db_id)

    for item in ITEMS:
        item_id = item["item_id"]
        doc_ref = db.collection("item_definitions").document(item_id)
        existing = doc_ref.get()

        now = datetime.datetime.now(datetime.timezone.utc)

        if existing.exists:
            print(f"  ✏️  Updating existing item: {item['name']} ({item_id})")
            doc_ref.set({
                **item,
                "updated_at": now,
            }, merge=True)
        else:
            print(f"  ✨ Creating new item: {item['name']} ({item_id})")
            doc_ref.set({
                **item,
                "created_at": now,
                "updated_at": now,
            })

    # Verify items
    print("\n🔍 Verifying seeded items:")
    for item in ITEMS:
        doc = db.collection("item_definitions").document(item["item_id"]).get()
        if doc.exists:
            data = doc.to_dict()
            print(
                f"  ✅ {data.get('name')} — "
                f"category: {data.get('category')}, "
                f"max_stack: {data.get('max_stack')}"
            )
        else:
            print(f"  ❌ {item['item_id']} — NOT FOUND")

    print(f"\n🏁 Done! {len(ITEMS)} item(s) seeded into {db_id}")

    # ── Quest Templates ───────────────────────────────────────────────────────
    print(f"\n📜 Seeding quest templates into {db_id}")

    for quest in QUESTS:
        quest_id = quest["quest_id"]
        doc_ref = db.collection("quest_templates").document(quest_id)
        existing = doc_ref.get()

        now = datetime.datetime.now(datetime.timezone.utc)

        if existing.exists:
            print(f"  ✏️  Updating existing quest: {quest['title']} ({quest_id})")
            doc_ref.set({
                **quest,
                "updated_at": now,
            }, merge=True)
        else:
            print(f"  ✨ Creating new quest: {quest['title']} ({quest_id})")
            doc_ref.set({
                **quest,
                "created_at": now,
                "updated_at": now,
            })

    # Verify quests
    print("\n🔍 Verifying seeded quests:")
    for quest in QUESTS:
        doc = db.collection("quest_templates").document(quest["quest_id"]).get()
        if doc.exists:
            data = doc.to_dict()
            rewards = data.get("rewards", [])
            reward_str = ", ".join(
                f"{r.get('quantity')}x {r.get('item_id')}" for r in rewards
            ) or "none"
            print(
                f"  ✅ {data.get('title')} — "
                f"type: {data.get('quest_type')}, "
                f"status: {data.get('status')}, "
                f"rewards: [{reward_str}]"
            )
        else:
            print(f"  ❌ {quest['quest_id']} — NOT FOUND")

    print(f"\n🏁 Done! {len(QUESTS)} quest(s) seeded into {db_id}")


if __name__ == "__main__":
    env = sys.argv[1] if len(sys.argv) > 1 else "dev"
    if env not in ("dev", "test", "prod"):
        print(f"❌ Invalid environment: {env}. Use dev, test, or prod.")
        sys.exit(1)
    seed_objects(env)

