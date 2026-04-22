import sys
import subprocess
import firebase_admin
from firebase_admin import auth, credentials
from google.cloud import firestore
from google.oauth2.credentials import Credentials

# --- Configuration ---
PROJECT_ID = "tavern-swiper-dev"
SERVICES = ["users", "profiles", "auth", "messages", "discovery"]

def get_gcloud_credentials():
    """Helper to fetch credentials from gcloud if Application Default Credentials are missing/broken."""
    try:
        # Try to get the active account's access token
        token = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode("utf-8").strip()
        return Credentials(token)
    except Exception as e:
        print(f"⚠️ Warning: Could not fetch gcloud token: {e}")
        return None

def delete_collection(coll_ref, batch_size=500):
    """Helper to recursively delete a Firestore collection in batches."""
    docs = coll_ref.limit(batch_size).stream()
    deleted = 0

    for doc in docs:
        # Delete sub-collections recursively if any (standard practice for a deep clean)
        # Note: In our current schema, we don't have deep sub-collections, but this is robust.
        for sub_coll in doc.reference.collections():
            delete_collection(sub_coll, batch_size)
        
        doc.reference.delete()
        deleted += 1

    if deleted >= batch_size:
        return delete_collection(coll_ref, batch_size)

def purge_system(env="dev", purge_auth=False):
    print(f"🚀 Starting Direct Firestore Purge for environment: {env}\n")
    # Map 'dev' and 'test' to their respective database/bucket suffixes
    suffix = f"-{env}"
    
    # 1. Initialize Credentials
    g_creds = get_gcloud_credentials()
    
    # 2. Clear Firestore Databases
    for service in SERVICES:
        db_id = f"{service}{suffix}"
        print(f"🗑️ Clearing Firestore Database: {db_id}...")
        try:
            # Use explicit credentials from gcloud to avoid ADC permission issues
            db = firestore.Client(project=PROJECT_ID, database=db_id, credentials=g_creds)
            collections = db.collections()
            count = 0
            for coll in collections:
                delete_collection(coll)
                count += 1
            print(f"  ✅ {db_id} cleared ({count} collections).")
        except Exception as e:
            print(f"  ❌ Error clearing {db_id}: {e}")

    # 3. Clear Firebase Auth (Optional: Standard for the whole project)
    if purge_auth:
        print("\n🔥 Purging Firebase Auth Users...")
        try:
            # Initialize Firebase Admin explicitly for the target project
            if not firebase_admin._apps:
                # We use an options dict to specify the project ID
                options = {'projectId': PROJECT_ID}
                try:
                    firebase_admin.initialize_app(options=options)
                except Exception as e:
                    print(f"  ⚠️ Warning: Firebase Admin initialization failed: {e}")
                    pass

            # Fetch and delete users in batches
            users = list(auth.list_users().iterate_all())
            uids = [user.uid for user in users]
            if uids:
                auth.delete_users(uids)
                print(f"  ✅ {len(uids)} users deleted from Firebase Auth ({PROJECT_ID}).")
            else:
                print(f"  ✅ No users found in Firebase Auth ({PROJECT_ID}).")
        except Exception as e:
            print(f"  ❌ Error purging Firebase Auth: {e}")
    else:
        print("\n🛡️  Skipping Firebase Auth purge (Preserving User UIDs).")

    # 4. Clear GCS Buckets (Hard Delete everything in the environment's media bucket)
    bucket_name = f"{PROJECT_ID}-media-{env}"
    print(f"\n🌊 Clearing GCS Bucket: {bucket_name}...")
    try:
        from google.cloud import storage
        # Use explicit project and credentials for reliability
        client = storage.Client(project=PROJECT_ID, credentials=g_creds)
        bucket = client.bucket(bucket_name)
        
        # Check if bucket exists first to avoid crashing if it hasn't been created yet
        if bucket.exists():
            blobs = list(bucket.list_blobs())
            if blobs:
                # Use batch delete (up to 1000 per call, bucket.delete_blobs handles this)
                bucket.delete_blobs(blobs)
                print(f"  ✅ {len(blobs)} blobs deleted from {bucket_name}.")
            else:
                print(f"  ✅ {bucket_name} is already empty.")
        else:
            print(f"  ⚠️ Warning: Bucket {bucket_name} does not exist. Skipping GCS purge.")
    except Exception as e:
        print(f"  ❌ Error clearing {bucket_name}: {e}")

    print("\n🏁 Direct system purge complete!")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Purge system data for a specific environment.")
    parser.add_argument("env", nargs="?", default="dev", help="Environment to purge (dev/test)")
    parser.add_argument("--clear-firebase", action="store_true", help="Also purge all Firebase Auth users (destructive to all envs)")
    
    args = parser.parse_args()
    purge_system(args.env, purge_auth=args.clear_firebase)
