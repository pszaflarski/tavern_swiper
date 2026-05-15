"""
Seed the "Meet the Barkeep" quest into the quests service.

This script:
1. Connects directly to Firestore (quests-{env}) using ADC
2. Creates (or overwrites) the quest template with a deterministic ID
3. Idempotent — safe to run multiple times

Usage:
    .venv/bin/python3 scripts/seed_quests.py [dev|test]
"""

import sys
import datetime

from google.cloud import firestore

# ─── Quest Definitions ───────────────────────────────────────────────────────

QUESTS = [
    {
        "quest_id": "meet_the_barkeep",
        "title": "Meet the Barkeep",
        "description": (
            "Every adventurer's journey begins at the tavern. "
            "Swipe right on one of the barkeeps and strike up a conversation. "
            "They might just have something interesting to say…"
        ),
        "quest_type": "story",
        "status": "active",
        "sort_order": 1,
        "metadata": {
            "trigger": "match_with_tavern_keeper",
            "reward_description": "A warm welcome and a free ale.",
        },
    },
]

# ─── Main ─────────────────────────────────────────────────────────────────────

def seed_quests(env: str):
    project_id = "tavern-swiper-dev" if env in ("dev", "test") else "tavern-swiper-prod"
    db_id = f"quests-{env}"

    print(f"🎯 Seeding quests into {db_id} (project: {project_id})")

    db = firestore.Client(project=project_id, database=db_id)

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

    # Verify
    print("\n🔍 Verifying seeded quests:")
    for quest in QUESTS:
        doc = db.collection("quest_templates").document(quest["quest_id"]).get()
        if doc.exists:
            data = doc.to_dict()
            print(f"  ✅ {data.get('title')} — status: {data.get('status')}, type: {data.get('quest_type')}")
        else:
            print(f"  ❌ {quest['quest_id']} — NOT FOUND")

    print(f"\n🏁 Done! {len(QUESTS)} quest(s) seeded into {db_id}")


if __name__ == "__main__":
    env = sys.argv[1] if len(sys.argv) > 1 else "dev"
    if env not in ("dev", "test", "prod"):
        print(f"❌ Invalid environment: {env}. Use dev, test, or prod.")
        sys.exit(1)
    seed_quests(env)
