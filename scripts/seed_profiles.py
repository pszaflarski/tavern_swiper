import requests
import csv
import os
import time
import sys
import subprocess
import json

# --- Configuration ---
PROJECT_ID = "tavern-swiper-dev"
REGION = "us-central1"

# Primary Seeder (Authenticated first to perform administrative overrides)
SEEDER_EMAIL = os.getenv("ROOT_EMAIL", "root@example.com")
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
            "users": 8006,
        }
        return f"http://localhost:{ports.get(service_name)}"
    
    # Fetch from Cloud Run
    if env == "dev":
        deploy_name = f"{service_name}-dev"
    elif env == "test":
        deploy_name = f"{service_name}-test"
    else:
        deploy_name = service_name
        
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name,
            "--platform", "managed", "--region", REGION, "--project", PROJECT_ID,
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

# Standardize paths to be absolute relative to the project root
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
CSV_PATH = os.path.join(PROJECT_ROOT, "sample_profiles", "profiles.csv")
SAMPLE_IMAGES_DIR = os.path.join(PROJECT_ROOT, "sample_profiles")

def get_token(email, password):
    """Register or Login a user to get their token and UID."""
    # We verify the token after login to ensure it's a valid Tavern token
    print(f"  Attempting login for {email}...")
    login_resp = requests.post(f"{AUTH_URL}/auth/login", json={"email": email, "password": password})
    if login_resp.status_code == 200:
        data = login_resp.json()
        id_token = data.get("id_token")
        uid = data.get("uid")
        
        # Exchange for Tavern token
        v_resp = requests.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token})
        if v_resp.status_code == 200:
            return v_resp.json()["token"], uid
        else:
            print(f"  ⚠️ Tavern Verification Failed for {email}: {v_resp.status_code} - {v_resp.text}")
    
    # Try register if login fails or is rejected
    print(f"  Sign-in failed for {email}. Attempting registration...")
    reg_resp = requests.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": password})
    if reg_resp.status_code == 200:
        data = reg_resp.json()
        id_token = data.get("id_token")
        uid = data.get("uid")
        
        # Exchange for Tavern token
        v_resp = requests.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token})
        if v_resp.status_code == 200:
            return v_resp.json()["token"], uid
        else:
             print(f"  ⚠️ Tavern Verification Failed after Registration for {email}: {v_resp.status_code} - {v_resp.text}")
    
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
                u_resp = requests.post(f"{USERS_URL}/users/", json=user_data, headers=seeder_headers)
                if u_resp.status_code not in [201, 200]:
                    print(f"Warning: Could not set user record/role for {email}: {u_resp.text}")
            
            user_map[email] = {"uid": uid, "token": token, "role": row["user_role"]}

    # 4. Create Profiles
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
        
        resp = requests.post(f"{PROFILES_URL}/profiles/", json=profile_data, headers=seeder_headers)
        if resp.status_code != 201:
            print(f"Failed to create profile: {resp.text}")
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
                            files=files
                        )
                        if img_resp.status_code == 200:
                            print(f"Successfully uploaded {img_filename}")
                        else:
                            print(f"Failed to upload {img_filename}: {img_resp.text}")

    print("\n✅ Multi-user seeding complete!")

if __name__ == "__main__":
    env = "dev"
    if len(sys.argv) > 1:
        env = sys.argv[1]
    
    print(f"🚀 Seeding profiles in {env} environment...")
    
    AUTH_URL = get_url("auth", env)
    PROFILES_URL = get_url("profiles", env)
    USERS_URL = get_url("users", env)
    
    if not all([AUTH_URL, PROFILES_URL, USERS_URL]):
        print("❌ Could not determine all service URLs.")
        sys.exit(1)
        
    seed_system()
