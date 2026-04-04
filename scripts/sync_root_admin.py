import os
import sys
from google.cloud import firestore
import firebase_admin
from firebase_admin import auth, credentials

# Configuration for environment
PROJECT_ID = "tavern-swiper-dev"
EMAIL = "peter@gmail.com"
USERS_DB_ID = sys.argv[1] if len(sys.argv) > 1 else "users"

def sync_root():
    print(f"🔄 Syncing Root Admin for {EMAIL} in project {PROJECT_ID} (DB: {USERS_DB_ID})...")
    
    # 1. Initialize Firebase Admin to get UID
    try:
        firebase_admin.initialize_app()
    except Exception:
        pass
        
    try:
        user = auth.get_user_by_email(EMAIL)
        uid = user.uid
        print(f"✅ Found Firebase User: {uid}")
    except Exception as e:
        print(f"❌ Error: User {EMAIL} not found in Firebase Auth: {e}")
        return

    # 2. Update Users Firestore Database
    db = firestore.Client(project=PROJECT_ID, database=USERS_DB_ID)
    user_ref = db.collection("users").document(uid)
    
    user_data = {
        "uid": uid,
        "email": EMAIL,
        "user_type": "root_admin",
        "is_deleted": False,
        "is_premium": True
    }
    
    try:
        user_ref.set(user_data, merge=True)
        print(f"✅ Successfully synced root_admin status for {uid} in Firestore.")
    except Exception as e:
        print(f"❌ Error updating Firestore: {e}")

if __name__ == "__main__":
    sync_root()
