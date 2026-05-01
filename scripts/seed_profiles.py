import requests
import csv
import os
import time
import sys
import subprocess
import json

# --- Configuration ---
def get_current_project():
    try:
        return subprocess.check_output(["gcloud", "config", "get-value", "project"]).decode("utf-8").strip()
    except:
        return "tavern-swiper-dev"

PROJECT_ID = get_current_project()
REGION = "us-central1"

# Primary Seeder (Authenticated first to perform administrative overrides)
SEEDER_EMAIL = os.getenv("ROOT_EMAIL", "root@tavernswiper.com")
SEEDER_PASSWORD = os.getenv("ROOT_PASSWORD", "Password123!")

def get_url(service_name, env="local"):
    # Check for explicit environment variable overrides
    env_var = f"{service_name.upper()}_URL"
    if os.getenv(env_var):
        return os.getenv(env_var)

    if env == "local":
        ports = {
            "auth": 8001,
            "profiles": 8002,
            "discovery": 8003,
            "messages": 8005,
            "users": 8006,
        }
        return f"http://127.0.0.1:{ports.get(service_name)}"
    
    # Fetch from Cloud Run
    if env == "dev":
        deploy_name = f"{service_name}-dev"
    elif env == "test":
        deploy_name = f"{service_name}-test"
    else:
        deploy_name = service_name
        
    region = REGION
        
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name,
            "--platform", "managed", "--region", region, "--project", PROJECT_ID,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
        return url
    except Exception:
        # Fallback for 'dev' if suffixed service not found
        if env == "dev":
            print(f"⚠️  Suffixed service {deploy_name} not found. Falling back to unsuffixed name: {service_name}")
            try:
                url = subprocess.check_output([
                    "gcloud", "run", "services", "describe", service_name,
                    "--platform", "managed", "--region", REGION, "--project", PROJECT_ID,
                    "--format", "value(status.url)"
                ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
                return url
            except Exception as e2:
                print(f"❌ Error fetching URL for fallback {service_name}: {e2}")
                return None
        return None

# These will be set in the __main__ block
AUTH_URL = None
PROFILES_URL = None
USERS_URL = None
DISCOVERY_URL = None
MESSAGES_URL = None

# Standardize paths to be absolute relative to the project root
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
CSV_PATH = os.path.join(PROJECT_ROOT, "sample_profiles", "profiles.csv")
SAMPLE_IMAGES_DIR = os.path.join(PROJECT_ROOT, "sample_profiles")

def get_token(email, password):
    """Register or Login a user to get their token and UID."""
    # We verify the token after login to ensure it's a valid Tavern token
    print(f"  Attempting login for {email}...")
    login_resp = requests.post(f"{AUTH_URL}/auth/login", json={"email": email, "password": password}, timeout=30)
    if login_resp.status_code == 200:
        data = login_resp.json()
        id_token = data.get("id_token")
        uid = data.get("uid")
        
        # Exchange for Tavern token
        v_resp = requests.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token}, timeout=30)
        if v_resp.status_code == 200:
            return v_resp.json()["token"], uid
        else:
            print(f"  ⚠️ Tavern Verification Failed for {email}: {v_resp.status_code} - {v_resp.text}")
    
    # Fallback to registration if login fails (expected for new users or fresh environments)
    if login_resp.status_code not in [401, 404]:
        print(f"  Login returned unexpected status {login_resp.status_code} for {email}.")
    
    print(f"  [First-time setup] Registering user: {email}...")
    reg_resp = requests.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": password}, timeout=30)
    if reg_resp.status_code == 200:
        data = reg_resp.json()
        id_token = data.get("id_token")
        uid = data.get("uid")
        
        # Exchange for Tavern token
        v_resp = requests.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token}, timeout=30)
        if v_resp.status_code == 200:
            return v_resp.json()["token"], uid
        else:
            msg = f"Tavern Verification Failed for {email} after registration.\n  Status: {v_resp.status_code} | Body: {v_resp.text}"
            raise Exception(msg)
    
    msg = f"Failed to auth {email}.\n  Login status: {login_resp.status_code} | Body: {login_resp.text}\n  Register status: {reg_resp.status_code} | Body: {reg_resp.text}"
    raise Exception(msg)

def seed_system():
    # 1. Login as primary seeder (Existing Root Admin)
    print(f"Authenticating primary seeder: {SEEDER_EMAIL}...")
    seeder_token, seeder_uid = get_token(SEEDER_EMAIL, SEEDER_PASSWORD)
    seeder_headers = {"Authorization": f"Bearer {seeder_token}"}

    # 2. Read CSV
    print(f"Reading {CSV_PATH}...")
    with open(CSV_PATH, mode='r') as f:
        rows = list(csv.DictReader(f))

    # 3. Setup Users & Roles
    user_map = {} # email -> {uid, token, role}
    for row in rows:
        email = row["email"]
        if email not in user_map:
            print(f"Setting up account: {email} ({row['user_role']})...")
            token, uid = get_token(email, row["password"])
            
            # Use SEEDER to set the role in the Users service
            user_data = {
                "uid": uid,
                "email": email,
                "user_type": row["user_role"],
                "is_premium": True
            }
            # Idempotency: skip seeder as he's already handled
            if email == SEEDER_EMAIL:
                print(f"  (Skipping {email} setup - already bootstrapped)")
            else:
                u_resp = requests.post(f"{USERS_URL}/users/", json=user_data, headers=seeder_headers, timeout=30)
                if u_resp.status_code not in [201, 200]:
                    print(f"  ❌ Could not set user record/role for {email}: {u_resp.status_code} {u_resp.text}")
            
            user_map[email] = {"uid": uid, "token": token, "role": row["user_role"]}

    # 4. Create Profiles and Collect for Interactions
    seeded_profiles = [] # list of {profile_id, token, name}
    for row in rows:
        email = row["email"]
        target_uid = user_map[email]["uid"]
        print(f"--- Seeding Profile: {row['name']} for {email} ---")
        
        profile_data = {
            "display_name": row["name"],
            "bio": row["bio"],
            "gender": row["gender"],
            "user_id": target_uid, # Administrative override!
            "is_active": True
        }
        
        resp = requests.post(f"{PROFILES_URL}/profiles/", json=profile_data, headers=seeder_headers, timeout=30)
        if resp.status_code != 201:
            print(f"Failed to create profile: {resp.status_code} {resp.text}")
            continue
        
        profile_id = resp.json()["profile_id"]
        print(f"Profile created: {profile_id}")

        # 5. Upload Images
        for i in range(1, 7):
            img_key = f"image_{i}"
            if row.get(img_key):
                img_filename = row[img_key]
                img_path = os.path.join(SAMPLE_IMAGES_DIR, img_filename)
                
                if os.path.exists(img_path) and img_filename:
                    print(f"Uploading {img_filename} to index {i-1}...")
                    with open(img_path, 'rb') as img_file:
                        files = {'file': (img_filename, img_file, 'image/jpeg')}
                        img_resp = requests.post(
                            f"{PROFILES_URL}/profiles/{profile_id}/image?index={i-1}",
                            headers=seeder_headers,
                            files=files,
                            timeout=60 # Larger timeout for image processing
                        )
                        if img_resp.status_code == 200:
                            print(f"Successfully uploaded {img_filename}")
                        else:
                            print(f"Failed to upload {img_filename}: {img_resp.status_code} {img_resp.text}")
        
        seeded_profiles.append({
            "profile_id": profile_id,
            "token": user_map[email]["token"],
            "name": row["name"]
        })

    # 6. Interaction Seeding (Mutual Match & Conversation)
    if len(seeded_profiles) >= 2:
        p1 = seeded_profiles[0]
        p2 = seeded_profiles[1]
        
        print(f"\n🤝 Creating Interaction between {p1['name']} and {p2['name']}...")
        
        # A. Mutual Match
        print(f"  {p1['name']} swipes RIGHT on {p2['name']}...")
        requests.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {p1['token']}"},
            json={
                "swiper_profile_id": p1['profile_id'],
                "swiped_profile_id": p2['profile_id'],
                "direction": "right"
            },
            timeout=30
        )
        
        print(f"  {p2['name']} swipes RIGHT on {p1['name']} (Mutual Match!)...")
        requests.post(
            f"{DISCOVERY_URL}/discovery/swipe/",
            headers={"Authorization": f"Bearer {p2['token']}"},
            json={
                "swiper_profile_id": p2['profile_id'],
                "swiped_profile_id": p1['profile_id'],
                "direction": "right"
            },
            timeout=30
        )
        
        # Wait for propagation (Matches service cache)
        print("  Waiting 5s for match propagation...")
        time.sleep(5)
        
        # B. Conversation
        print(f"  {p1['name']} initiating conversation...")
        conv_resp = requests.post(
            f"{MESSAGES_URL}/messages/conversations",
            headers={"Authorization": f"Bearer {p1['token']}"},
            json={"participant_profile_ids": [p1['profile_id'], p2['profile_id']]},
            timeout=30
        )
        
        if conv_resp.status_code in [200, 201]:
            conv_id = conv_resp.json()["conversation_id"]
            print(f"  Conversation established: {conv_id}")
            
            # Message 1: P1 -> P2
            msg1 = "Greetings! I've been looking for a brave soul to join me at the Rusty Dragon. Interested?"
            print(f"  {p1['name']} sending first message...")
            requests.post(
                f"{MESSAGES_URL}/messages/conversations/{conv_id}/messages",
                headers={"Authorization": f"Bearer {p1['token']}"},
                json={"sender_profile_id": p1['profile_id'], "content": msg1},
                timeout=30
            )
            
            time.sleep(1.5) # Ensure distinct timestamps
            
            # Message 2: P2 -> P1
            msg2 = "The Rusty Dragon? Count me in! I'll bring the map. What time are we meeting?"
            print(f"  {p2['name']} sending reply...")
            requests.post(
                f"{MESSAGES_URL}/messages/conversations/{conv_id}/messages",
                headers={"Authorization": f"Bearer {p2['token']}"},
                json={"sender_profile_id": p2['profile_id'], "content": msg2},
                timeout=30
            )
            print("  ✅ Seeded back-and-forth conversation.")
        else:
            print(f"  ⚠️ Could not initiate conversation: {conv_resp.status_code} {conv_resp.text}")

    print("\n✅ Multi-user seeding complete!")

if __name__ == "__main__":
    env = "dev"
    if len(sys.argv) > 1:
        env = sys.argv[1]
    
    print(f"🚀 Seeding profiles in {env} environment...")
    
    AUTH_URL = get_url("auth", env)
    PROFILES_URL = get_url("profiles", env)
    USERS_URL = get_url("users", env)
    DISCOVERY_URL = get_url("discovery", env)
    MESSAGES_URL = get_url("messages", env)
    
    if not all([AUTH_URL, PROFILES_URL, USERS_URL, DISCOVERY_URL, MESSAGES_URL]):
        print("❌ Could not determine all service URLs.")
        sys.exit(1)
        
    seed_system()
