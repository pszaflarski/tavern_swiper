import sys
import firebase_admin
from firebase_admin import auth

# --- Configuration ---
PROJECT_ID = "tavern-swiper-dev"

def delete_user_by_email(email):
    """Finds a Firebase Auth user by email and deletes them."""
    print(f"🏹 Targeting Identity: {email}...")

    # 1. Initialize Firebase Admin
    if not firebase_admin._apps:
        options = {'projectId': PROJECT_ID}
        firebase_admin.initialize_app(options=options)

    try:
        # 2. Look up the user by email to get their UID
        user = auth.get_user_by_email(email)
        uid = user.uid
        print(f"  🔍 Found UID: {uid}")

        # 3. Perform the assassination
        auth.delete_user(uid)
        print(f"  ✅ Successfully deleted {email} from Firebase Auth.")

    except auth.UserNotFoundError:
        print(f"  ❌ Error: No identity found for email '{email}'.")
    except Exception as e:
        print(f"  ❌ An unexpected error occurred: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/delete_user.py <email>")
        sys.exit(1)

    target_email = sys.argv[1]
    delete_user_by_email(target_email)
