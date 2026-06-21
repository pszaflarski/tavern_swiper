#!/usr/bin/env python3
"""
cleanup_legacy_tag_fields.py

Removes the legacy denormalized tag fields (fandom, race, gender, class) from
character documents that have already been migrated to the character_tags format.

Only touches documents that HAVE a character_tags field (i.e. already migrated).
Documents without character_tags are skipped and reported as warnings.

Usage:
    .venv/bin/python3 scripts/cleanup_legacy_tag_fields.py dev --dry-run
    .venv/bin/python3 scripts/cleanup_legacy_tag_fields.py dev
    .venv/bin/python3 scripts/cleanup_legacy_tag_fields.py prod
"""

import sys
import subprocess
import argparse

from google.cloud import firestore
from google.oauth2.credentials import Credentials


LEGACY_FIELDS = ["fandom", "race", "gender", "class"]
COLLECTION = "characters"


def get_gcloud_credentials():
    """Helper to fetch credentials from gcloud."""
    try:
        token = subprocess.check_output(
            ["gcloud", "auth", "print-access-token"]
        ).decode("utf-8").strip()
        return Credentials(token)
    except Exception as e:
        print(f"⚠️ Warning: Could not fetch gcloud token: {e}")
        return None


def get_project_id(env: str) -> str:
    if env == "prod":
        return "tavern-swiper-prod"
    return "tavern-swiper-dev"


def get_database_id(env: str) -> str:
    return f"characters-{env}"


def cleanup(env: str, dry_run: bool = False):
    project_id = get_project_id(env)
    database_id = get_database_id(env)

    if env == "prod":
        print("⚠️  WARNING: This command will modify the PRODUCTION environment.")
        print(f"   Project : {project_id}")
        print(f"   Database: {database_id}")
        confirmation = input("\nType 'Yes, proceed with Prod' to continue: ")
        if confirmation != "Yes, proceed with Prod":
            print("🚫 Aborted. No changes were made.")
            sys.exit(1)

    mode_label = "DRY-RUN" if dry_run else "LIVE"
    print(f"\n🧹 [{mode_label}] Cleaning up legacy tag fields in '{database_id}' (project: {project_id})\n")

    creds = get_gcloud_credentials()
    if creds is None:
        print("❌ Could not obtain credentials. Aborting.")
        sys.exit(1)

    db = firestore.Client(project=project_id, database=database_id, credentials=creds)
    docs = list(db.collection(COLLECTION).stream())
    print(f"📄 Found {len(docs)} document(s) in '{COLLECTION}' collection.\n")

    cleaned = 0
    skipped_no_migration = 0
    skipped_no_legacy = 0
    errors = 0

    for doc in docs:
        doc_data = doc.to_dict()
        doc_id = doc.id
        display_name = doc_data.get("display_name", "(unnamed)")

        # Safety: only clean docs that have been migrated
        if "character_tags" not in doc_data:
            print(f"  ⚠️  {doc_id} ({display_name}) — NOT MIGRATED (no character_tags), skipping")
            skipped_no_migration += 1
            continue

        # Find which legacy fields still exist
        fields_to_delete = [f for f in LEGACY_FIELDS if f in doc_data]

        if not fields_to_delete:
            print(f"  ⏭️  {doc_id} ({display_name}) — no legacy fields, already clean")
            skipped_no_legacy += 1
            continue

        print(f"  {'🔍' if dry_run else '🗑️'}  {doc_id} ({display_name})")
        print(f"       deleting: {fields_to_delete}")

        if not dry_run:
            try:
                update_data = {f: firestore.DELETE_FIELD for f in fields_to_delete}
                doc.reference.update(update_data)
                cleaned += 1
            except Exception as e:
                print(f"       ❌ Error: {e}")
                errors += 1
        else:
            cleaned += 1

    print(f"\n{'─' * 50}")
    print(f"📊 Cleanup Summary ({mode_label})")
    print(f"{'─' * 50}")
    print(f"   Total documents       : {len(docs)}")
    print(f"   Cleaned               : {cleaned}")
    print(f"   Skipped (not migrated): {skipped_no_migration}")
    print(f"   Skipped (already clean): {skipped_no_legacy}")
    print(f"   Errors                : {errors}")
    print(f"{'─' * 50}")

    if errors > 0:
        print(f"\n🔴 {errors} error(s) occurred. Review output above.")
        sys.exit(1)

    if skipped_no_migration > 0:
        print(f"\n⚠️  {skipped_no_migration} document(s) were NOT migrated yet. Run migrate_character_tags.py first.")

    if dry_run and cleaned > 0:
        print("\n💡 Run without --dry-run to apply changes.")

    print("\n🏁 Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Remove legacy tag fields (fandom, race, gender, class) from migrated character documents."
    )
    parser.add_argument("env", choices=["dev", "test", "prod"], help="Target environment")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")

    args = parser.parse_args()
    cleanup(args.env, dry_run=args.dry_run)
