"""
Cleanup script for duplicate conversations in production.

This script:
1. Queries messages-prod for conversations with duplicate participants
2. For each duplicate set, identifies the "real" conversation (has messages)
   and the "orphan" (empty shell)
3. Migrates profile_conversations mappings from orphan to real
4. Deletes the orphan conversation document
5. Ensures conversation_dedup entry points to the real conversation

⚠️ WARNING: This script modifies the PRODUCTION environment (tavern-swiper-prod).
"""

import sys
import subprocess
from google.cloud import firestore
from google.oauth2.credentials import Credentials


def get_gcloud_credentials():
    try:
        token = subprocess.check_output(
            ["gcloud", "auth", "print-access-token"]
        ).decode("utf-8").strip()
        return Credentials(token)
    except Exception as e:
        print(f"⚠️ Could not fetch gcloud token: {e}")
        sys.exit(1)


def main():
    project_id = "tavern-swiper-prod"
    database_id = "messages-prod"

    print("⚠️  WARNING: This command will modify the PRODUCTION environment.")
    print(f"    Project: {project_id}")
    print(f"    Database: {database_id}")
    print()

    confirm = input("Type 'yes-prod' to proceed: ").strip()
    if confirm != "yes-prod":
        print("Aborted.")
        sys.exit(0)

    g_creds = get_gcloud_credentials()
    db = firestore.Client(project=project_id, database=database_id, credentials=g_creds)

    # Step 1: Find all conversations and group by sorted participants
    print("\n📥 Querying all conversations...")
    conversations_ref = db.collection("conversations")
    docs = list(conversations_ref.stream())

    by_participants = {}
    for doc in docs:
        data = doc.to_dict()
        participants = data.get("participant_ids", [])
        sorted_key = "_".join(sorted(participants))
        if sorted_key not in by_participants:
            by_participants[sorted_key] = []
        by_participants[sorted_key].append({
            "id": doc.id,
            "data": data,
            "ref": doc.reference,
        })

    duplicates = {k: v for k, v in by_participants.items() if len(v) > 1}

    if not duplicates:
        print("✅ No duplicate conversations found. Nothing to clean up.")
        return

    print(f"Found {len(duplicates)} sets of duplicate conversations.\n")

    for idx, (participants_key, convs) in enumerate(duplicates.items(), 1):
        print(f"{'='*60}")
        print(f"Set #{idx}: participants_key = {participants_key}")

        # Determine which conversation is the "real" one (has last_message_text)
        real = None
        orphans = []
        for c in convs:
            last_msg = c["data"].get("last_message_text")
            last_sent = c["data"].get("last_message_sent_at")
            if last_msg and last_sent:
                if real is None:
                    real = c
                else:
                    # Multiple conversations have messages — keep the one with
                    # the most recent activity
                    real_sent = real["data"].get("last_message_sent_at")
                    if last_sent > real_sent:
                        orphans.append(real)
                        real = c
                    else:
                        orphans.append(c)
            else:
                orphans.append(c)

        # If no conversation has messages, pick the oldest as "real"
        if real is None:
            convs_sorted = sorted(convs, key=lambda c: c["data"].get("created_at", ""))
            real = convs_sorted[0]
            orphans = convs_sorted[1:]

        print(f"  ✅ KEEP:   {real['id']} (created: {real['data'].get('created_at')})")
        for orphan in orphans:
            print(f"  🗑️  DELETE: {orphan['id']} (created: {orphan['data'].get('created_at')})")

        # Step 2: For each orphan, migrate profile_conversations and delete
        for orphan in orphans:
            orphan_id = orphan["id"]
            real_id = real["id"]

            # Check if any profile_conversations point to the orphan
            pc_query = db.collection("profile_conversations").where(
                "conversation_id", "==", orphan_id
            )
            orphan_pcs = list(pc_query.stream())

            if orphan_pcs:
                print(f"  📎 Migrating {len(orphan_pcs)} profile_conversation(s) from {orphan_id} → {real_id}")
                batch = db.batch()
                for pc_doc in orphan_pcs:
                    pc_data = pc_doc.to_dict()
                    profile_id = pc_data.get("profile_id", "")
                    new_pc_id = f"{profile_id}_{real_id}"

                    # Check if the real mapping already exists
                    real_pc_ref = db.collection("profile_conversations").document(new_pc_id)
                    real_pc_snap = real_pc_ref.get()
                    if not real_pc_snap.exists:
                        batch.set(real_pc_ref, {
                            "profile_id": profile_id,
                            "conversation_id": real_id,
                            "role": pc_data.get("role", "participant"),
                        })
                        print(f"    → Created mapping {new_pc_id}")
                    else:
                        print(f"    → Mapping {new_pc_id} already exists, skipping")

                    # Delete the orphan mapping
                    batch.delete(pc_doc.reference)
                    print(f"    → Deleted orphan mapping {pc_doc.id}")

                batch.commit()

            # Delete any messages sub-collection in the orphan (should be empty, but be safe)
            orphan_msgs = list(
                db.collection("conversations").document(orphan_id)
                .collection("messages").stream()
            )
            if orphan_msgs:
                print(f"  ⚠️  Orphan {orphan_id} has {len(orphan_msgs)} messages — deleting them")
                batch = db.batch()
                for msg_doc in orphan_msgs:
                    batch.delete(msg_doc.reference)
                batch.commit()

            # Delete the orphan conversation document
            db.collection("conversations").document(orphan_id).delete()
            print(f"  ✅ Deleted orphan conversation {orphan_id}")

        # Step 3: Ensure conversation_dedup entry exists and points to the real conversation
        dedup_ref = db.collection("conversation_dedup").document(participants_key)
        dedup_ref.set({
            "conversation_id": real["id"],
            "participants_key": participants_key,
            "created_at": firestore.SERVER_TIMESTAMP,
        })
        print(f"  ✅ Ensured dedup entry for {participants_key} → {real['id']}")

    print(f"\n{'='*60}")
    print("🏁 Cleanup complete!")

    # Verification: re-query to confirm no duplicates remain
    print("\n🔍 Verifying no duplicates remain...")
    docs = list(conversations_ref.stream())
    by_participants = {}
    for doc in docs:
        data = doc.to_dict()
        participants = data.get("participant_ids", [])
        sorted_key = "_".join(sorted(participants))
        if sorted_key not in by_participants:
            by_participants[sorted_key] = []
        by_participants[sorted_key].append(doc.id)

    remaining = {k: v for k, v in by_participants.items() if len(v) > 1}
    if remaining:
        print(f"❌ Still found {len(remaining)} duplicate sets! Manual investigation needed.")
        for k, v in remaining.items():
            print(f"   {k}: {v}")
    else:
        print(f"✅ Verified: 0 duplicates remain across {len(docs)} conversations.")


if __name__ == "__main__":
    main()
