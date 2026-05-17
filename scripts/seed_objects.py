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
            "The universal currency of the tavern. "
            "Earned through quests, wagers, and acts of valor."
        ),
        "image_url": "",
        "category": "currency",
        "max_stack": 0,  # unlimited
        "tradeable": True,
        "metadata": {},
    },
    {
        "item_id": "dice_d6",
        "name": "D6 Die",
        "description": (
            "A trusty six-sided die. "
            "The workhorse of any tavern game night."
        ),
        "image_url": "",
        "category": "key_item",
        "max_stack": 0,
        "tradeable": False,
        "metadata": {"sides": 6, "dice_type": "d6"},
    },
    {
        "item_id": "dice_d8",
        "name": "D8 Die",
        "description": (
            "An eight-sided die favored by fortune-tellers "
            "and gamblers with something to prove."
        ),
        "image_url": "",
        "category": "key_item",
        "max_stack": 0,
        "tradeable": False,
        "metadata": {"sides": 8, "dice_type": "d8"},
    },
    {
        "item_id": "dice_d12",
        "name": "D12 Die",
        "description": (
            "A twelve-sided die carved from ancient stone. "
            "Its weight carries a certain gravitas."
        ),
        "image_url": "",
        "category": "key_item",
        "max_stack": 0,
        "tradeable": False,
        "metadata": {"sides": 12, "dice_type": "d12"},
    },
    {
        "item_id": "dice_d20",
        "name": "D20 Die",
        "description": (
            "The legendary twenty-sided die. "
            "When fate itself hangs in the balance, only the D20 will do."
        ),
        "image_url": "",
        "category": "key_item",
        "max_stack": 0,
        "tradeable": False,
        "metadata": {"sides": 20, "dice_type": "d20"},
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

    # Verify
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


if __name__ == "__main__":
    env = sys.argv[1] if len(sys.argv) > 1 else "dev"
    if env not in ("dev", "test", "prod"):
        print(f"❌ Invalid environment: {env}. Use dev, test, or prod.")
        sys.exit(1)
    seed_objects(env)
