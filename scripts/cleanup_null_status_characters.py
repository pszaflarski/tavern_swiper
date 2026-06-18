#!/usr/bin/env python3
import os
import sys
import subprocess
from google.cloud import firestore
from google.cloud import storage
from google.oauth2.credentials import Credentials

def get_gcloud_credentials():
    """Helper to fetch credentials from gcloud if Application Default Credentials are missing/broken."""
    try:
        token = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode("utf-8").strip()
        return Credentials(token)
    except Exception as e:
        print(f"⚠️ Warning: Could not fetch gcloud token: {e}")
        return None

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/cleanup_null_status_characters.py <env> [target_status]")
        print("Example: python3 scripts/cleanup_null_status_characters.py dev")
        print("Example (for pending): python3 scripts/cleanup_null_status_characters.py dev pending")
        sys.exit(1)

    env = sys.argv[1].lower()
    if env not in ["dev", "test", "prod"]:
        print(f"❌ Error: Invalid environment '{env}'. Must be one of: dev, test, prod")
        sys.exit(1)

    target_status = None
    if len(sys.argv) >= 3:
        target_status = sys.argv[2].lower()

    # Determine project ID
    if env == "prod":
        project_id = "tavern-swiper-prod"
        print("⚠️ WARNING: This command will modify the PRODUCTION environment.")
        confirm = input("Are you absolutely sure you want to run this on PRODUCTION? (Type 'Yes, proceed with Prod' to continue): ")
        if confirm != "Yes, proceed with Prod":
            print("❌ Execution aborted.")
            sys.exit(1)
    else:
        project_id = "tavern-swiper-dev"

    database_id = f"characters-{env}"
    bucket_name = f"{project_id}-media-{env}"

    print(f"🔍 Initializing Firestore client for project: {project_id}, database: {database_id}...")
    
    g_creds = get_gcloud_credentials()
    db = firestore.Client(project=project_id, database=database_id, credentials=g_creds)
    
    try:
        storage_client = storage.Client(project=project_id, credentials=g_creds)
        bucket = storage_client.bucket(bucket_name)
        bucket_exists = bucket.exists()
    except Exception as e:
        print(f"⚠️ Warning: Could not connect to GCS: {e}. GCS image deletion will be skipped.")
        bucket_exists = False
        bucket = None

    print(f"📋 Fetching characters from collection 'characters'...")
    try:
        char_ref = db.collection("characters")
        docs = list(char_ref.stream())
    except Exception as e:
        print(f"❌ Error fetching characters: {e}")
        sys.exit(1)

    if target_status and target_status != "null":
        print(f"Found {len(docs)} total characters. Scanning for status='{target_status}'...")
    else:
        print(f"Found {len(docs)} total characters. Scanning for null/missing status...")

    deleted_count = 0
    for doc in docs:
        data = doc.to_dict()
        status = data.get("status")
        
        should_delete = False
        if target_status and target_status != "null":
            if status is not None and str(status).lower() == target_status:
                should_delete = True
        else:
            if "status" not in data or status is None:
                should_delete = True

        if should_delete:
            char_id = doc.id
            display_name = data.get("display_name", "Unknown Name")
            print(f"🧹 Deleting character: ID={char_id}, Name='{display_name}', Status={status}...")

            # 1. Delete associated image metadata documents in Firestore
            try:
                images_ref = db.collection("images")
                img_docs = list(images_ref.stream())
                img_deleted = 0
                for img_doc in img_docs:
                    img_data = img_doc.to_dict()
                    if img_data.get("character_id") == char_id:
                        img_doc.reference.delete()
                        img_deleted += 1
                if img_deleted > 0:
                    print(f"  🗑️ Deleted {img_deleted} image metadata documents.")
            except Exception as e:
                print(f"  ⚠️ Error deleting image metadata for character {char_id}: {e}")

            # 2. Delete GCS images
            if bucket_exists and bucket:
                try:
                    prefix = f"characters/{char_id}/"
                    blobs = list(bucket.list_blobs(prefix=prefix))
                    if blobs:
                        bucket.delete_blobs(blobs)
                        print(f"  🌊 Deleted {len(blobs)} image files from GCS (prefix: {prefix}).")
                except Exception as e:
                    print(f"  ⚠️ Error deleting GCS files for character {char_id}: {e}")

            # 3. Delete the character document itself
            doc.reference.delete()
            print(f"  ✅ Character {char_id} deleted successfully.")
            deleted_count += 1

    if target_status and target_status != "null":
        print(f"\n🏁 Finished! Deleted {deleted_count} characters with status '{target_status}'.")
    else:
        print(f"\n🏁 Finished! Deleted {deleted_count} characters with null/missing status.")

if __name__ == "__main__":
    main()
