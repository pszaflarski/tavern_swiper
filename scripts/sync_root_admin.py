import os
import sys
from google.cloud import firestore
import firebase_admin
from firebase_admin import auth, credentials

# Map environment names to GCP project IDs
PROJECT_MAP = {
    "dev": "tavern-swiper-dev",
    "test": "tavern-swiper-dev",
    "prod": "tavern-swiper-prod",
}

DEFAULT_EMAIL = os.getenv("ROOT_EMAIL", "root@tavernswiper.com")

def sync_root(env="dev", email=DEFAULT_EMAIL):
    if env not in PROJECT_MAP:
        print(f"❌ Unknown environment: {env}. Valid options: {list(PROJECT_MAP.keys())}")
        sys.exit(1)

    project_id = PROJECT_MAP[env]
    db_id = f"users-{env}"

    print(f"🔄 Syncing Root Admin for {email} in project {project_id} (DB: {db_id})...")
    
    # 1. Initialize Firebase Admin to get UID
    try:
        firebase_admin.initialize_app()
    except Exception:
        pass
        
    try:
        user = auth.get_user_by_email(email)
        uid = user.uid
        print(f"✅ Found Firebase User: {uid}")
    except Exception as e:
        print(f"❌ Error: User {email} not found in Firebase Auth: {e}")
        return

    # 2. Update Users Firestore Database
    db = firestore.Client(project=project_id, database=db_id)
    
    # Demote any OTHER root admins to preserve singleton invariant
    try:
        other_roots = db.collection("users").where("user_type", "==", "root_admin").stream()
        for doc in other_roots:
            if doc.id != uid:
                print(f"⚠️ Demoting existing root admin: {doc.id} ({doc.to_dict().get('email', 'unknown')})")
                doc.reference.update({"user_type": "user"})
    except Exception as e:
        print(f"⚠️ Warning during other roots cleanup: {e}")

    # Upsert target user as root admin
    user_ref = db.collection("users").document(uid)
    user_data = {
        "uid": uid,
        "email": email,
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
    env = "dev"
    email = DEFAULT_EMAIL
    
    if len(sys.argv) > 1:
        env = sys.argv[1]
    if len(sys.argv) > 2:
        email = sys.argv[2]
        
    sync_root(env, email)

