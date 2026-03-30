from google.cloud import firestore
import firebase_admin
from firebase_admin import auth, credentials
import os

# --- Configuration ---
PROJECT_ID = "tavern-swiper-dev"
# All test databases defined in our architecture
DATABASES = ["auth-test", "profiles-test", "discovery-test", "swipes-test", "messages-test", "users-test"]

def delete_collections(db):
    print(f"  Purging database: {db._database}...")
    try:
        collections = db.collections()
        for col in collections:
            print(f"    🗑️ Deleting collection: {col.id}...")
            # Simple batch delete for small test datasets
            docs = list(col.limit(500).stream())
            while docs:
                batch = db.batch()
                for doc in docs:
                    batch.delete(doc.reference)
                batch.commit()
                docs = list(col.limit(500).stream())
    except Exception as e:
        print(f"    ❌ Error cleaning {db._database}: {e}")

def clear_auth():
    print(f"\n🔑 Purging Firebase Auth for project {PROJECT_ID}...")
    try:
        users = auth.list_users().iterate_all()
        uids = [u.uid for u in users]
        if uids:
            # Batch delete
            for i in range(0, len(uids), 1000):
                batch = uids[i:i + 1000]
                auth.delete_users(batch)
            print(f"    ✅ Deleted {len(uids)} users from Auth.")
        else:
            print("    ✅ Auth is already empty.")
    except Exception as e:
        print(f"    ❌ Error clearing Auth: {e}")

def clear_all():
    print(f"🚀 Starting System-Wide Purge for {PROJECT_ID}\n")

    # 1. Initialize Firebase Admin (for Auth)
    try:
        firebase_admin.get_app()
    except ValueError:
        firebase_admin.initialize_app(options={'projectId': PROJECT_ID})

    # 2. Purge Firestore Databases
    for db_id in DATABASES:
        db = firestore.Client(project=PROJECT_ID, database=db_id)
        delete_collections(db)
        print(f"  ✅ {db_id} cleared.")

    # 3. Purge Auth
    clear_auth()

    print("\n🏁 System-wide purge complete!")

if __name__ == "__main__":
    clear_all()

if __name__ == "__main__":
    clear_all()
