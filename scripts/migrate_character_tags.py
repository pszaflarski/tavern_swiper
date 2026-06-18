#!/usr/bin/env python3
"""
migrate_character_tags.py

Migrates character documents from the OLD tag format (separate `fandom`, `race`,
`gender`, `class` array fields containing denormalized tag objects) to the NEW
format (single `character_tags` array of hierarchical slug strings).

Hierarchical slug format:
  - Fandom tags are stored as-is: "fandom__d_d"
  - Child tags are prefixed with the fandom slug: "fandom__d_d.race__elf"
  - Tags without a fandom parent are stored as-is: "gender__female"

This script ADDS the `character_tags` field but does NOT remove the old fields.
Old fields are kept for backward compatibility with the currently-deployed code.
Run a separate cleanup script after the new code is deployed and verified.

Usage:
    .venv/bin/python3 scripts/migrate_character_tags.py dev
    .venv/bin/python3 scripts/migrate_character_tags.py dev --dry-run
    .venv/bin/python3 scripts/migrate_character_tags.py prod
"""

import sys
import subprocess
import argparse

from google.cloud import firestore
from google.oauth2.credentials import Credentials


# --- Tag category fields to migrate ---
OLD_TAG_FIELDS = ["fandom", "race", "gender", "class"]

COLLECTION = "characters"


# --- Credential helper (matches clear_system.py pattern) ---
def get_gcloud_credentials():
    """Helper to fetch credentials from gcloud if Application Default Credentials are missing/broken."""
    try:
        token = subprocess.check_output(
            ["gcloud", "auth", "print-access-token"]
        ).decode("utf-8").strip()
        return Credentials(token)
    except Exception as e:
        print(f"⚠️ Warning: Could not fetch gcloud token: {e}")
        return None


def get_project_id(env: str) -> str:
    """Return the GCP project ID for the given environment."""
    if env == "prod":
        return "tavern-swiper-prod"
    return "tavern-swiper-dev"


def get_database_id(env: str) -> str:
    """Return the Firestore database ID for the given environment."""
    return f"characters-{env}"


def build_hierarchical_slugs(doc_data: dict) -> list[str]:
    """
    Build hierarchical slug strings from old tag fields.

    The fandom slug is the root. All child tags (race, gender, class) get
    prefixed with the fandom slug, e.g. "fandom__d_d.race__elf".

    If there's no fandom, child tags are stored as-is (flat slug).
    """
    slugs: list[str] = []

    # Extract fandom slugs first
    fandom_slugs: list[str] = []
    fandom_list = doc_data.get("fandom")
    if isinstance(fandom_list, list):
        for tag_obj in fandom_list:
            if isinstance(tag_obj, dict) and "slug" in tag_obj:
                fandom_slugs.append(tag_obj["slug"])
                slugs.append(tag_obj["slug"])

    # Determine prefix (first fandom, or empty if none)
    fandom_prefix = fandom_slugs[0] if fandom_slugs else ""

    # Process child categories
    for field in ["race", "gender", "class"]:
        tag_list = doc_data.get(field)
        if not isinstance(tag_list, list):
            continue
        for tag_obj in tag_list:
            if isinstance(tag_obj, dict) and "slug" in tag_obj:
                child_slug = tag_obj["slug"]
                if fandom_prefix:
                    slugs.append(f"{fandom_prefix}.{child_slug}")
                else:
                    slugs.append(child_slug)

    return slugs


def migrate(env: str, dry_run: bool = False):
    project_id = get_project_id(env)
    database_id = get_database_id(env)

    # --- Prod safety gate ---
    if env == "prod":
        print("⚠️  WARNING: This command will modify the PRODUCTION environment.")
        print(f"   Project : {project_id}")
        print(f"   Database: {database_id}")
        confirmation = input("\nType 'Yes, proceed with Prod' to continue: ")
        if confirmation != "Yes, proceed with Prod":
            print("🚫 Aborted. No changes were made.")
            sys.exit(1)

    mode_label = "DRY-RUN" if dry_run else "LIVE"
    print(f"\n🚀 [{mode_label}] Migrating character tags in '{database_id}' (project: {project_id})\n")

    # --- Initialise Firestore client ---
    creds = get_gcloud_credentials()
    if creds is None:
        print("❌ Could not obtain credentials. Aborting.")
        sys.exit(1)

    db = firestore.Client(project=project_id, database=database_id, credentials=creds)
    coll_ref = db.collection(COLLECTION)

    # --- Stream all character documents ---
    docs = list(coll_ref.stream())
    print(f"📄 Found {len(docs)} document(s) in '{COLLECTION}' collection.\n")

    migrated = 0
    skipped_already = 0
    skipped_no_tags = 0
    errors = 0

    for doc in docs:
        doc_data = doc.to_dict()
        doc_id = doc.id
        display_name = doc_data.get("display_name", "(unnamed)")

        # --- Idempotency: skip if already migrated ---
        if "character_tags" in doc_data:
            print(f"  ⏭️  {doc_id} ({display_name}) — already has 'character_tags', skipping")
            skipped_already += 1
            continue

        # --- Build hierarchical slugs from old fields ---
        slugs = build_hierarchical_slugs(doc_data)

        if not slugs:
            # Check if old fields exist but are empty
            has_any_old_field = any(field in doc_data for field in OLD_TAG_FIELDS)
            if has_any_old_field:
                # Fields exist but are empty — still write an empty character_tags
                slugs = []
            else:
                print(f"  ⏭️  {doc_id} ({display_name}) — no old tag fields found, skipping")
                skipped_no_tags += 1
                continue

        # --- Build update: ADD character_tags, KEEP old fields ---
        update_data = {"character_tags": slugs}

        print(f"  {'🔍' if dry_run else '✏️'}  {doc_id} ({display_name})")
        print(f"       character_tags = {slugs}")

        if not dry_run:
            try:
                doc.reference.update(update_data)
                migrated += 1
            except Exception as e:
                print(f"       ❌ Error updating {doc_id}: {e}")
                errors += 1
        else:
            migrated += 1

    # --- Summary ---
    print(f"\n{'─' * 50}")
    print(f"📊 Migration Summary ({mode_label})")
    print(f"{'─' * 50}")
    print(f"   Total documents     : {len(docs)}")
    print(f"   Migrated            : {migrated}")
    print(f"   Skipped (already)   : {skipped_already}")
    print(f"   Skipped (no tags)   : {skipped_no_tags}")
    print(f"   Errors              : {errors}")
    print(f"{'─' * 50}")

    if errors > 0:
        print(f"\n🔴 {errors} error(s) occurred. Review output above.")
        sys.exit(1)

    if dry_run and migrated > 0:
        print("\n💡 Run without --dry-run to apply changes.")

    print("\n🏁 Done.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Migrate character documents: add character_tags field with hierarchical slugs."
    )
    parser.add_argument(
        "env",
        choices=["dev", "test", "prod"],
        help="Target environment",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing to Firestore",
    )

    args = parser.parse_args()
    migrate(args.env, dry_run=args.dry_run)
