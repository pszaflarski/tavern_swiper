import requests
import csv
import os
import time
import sys
import subprocess
import json

# --- Configuration ---
# Map environment names to GCP project IDs
PROJECT_MAP = {
    "local": "tavern-swiper-dev",
    "dev": "tavern-swiper-dev",
    "test": "tavern-swiper-dev",
    "prod": "tavern-swiper-prod",
}

def get_project_id(env):
    return PROJECT_MAP.get(env, "tavern-swiper-dev")

REGION = "us-central1"

# Primary Seeder (Authenticated first to perform administrative overrides)
SEEDER_EMAIL = os.getenv("ROOT_EMAIL", "root@tavernswiper.com")
SEEDER_PASSWORD = os.getenv("ROOT_PASSWORD", "Password123!")

_ROUTER_DATA = None

def get_url(service_name, env="local"):
    global _ROUTER_DATA
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
    
    # 1. Try fetching from Router if not already cached
    if _ROUTER_DATA is None:
        project_id = get_project_id(env)
        try:
            # Standard suffix: router-dev, router-test, router-prod
            deploy_name = f"router-{env}"
            
            router_url = subprocess.check_output([
                "gcloud", "run", "services", "describe", deploy_name,
                "--platform", "managed", "--region", REGION, "--project", project_id,
                "--format", "value(status.url)"
            ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
            
            # Query Router
            print(f"📡 Querying Router at {router_url}...")
            resp = requests.get(f"{router_url}/router/services", timeout=5)
            if resp.status_code == 200:
                _ROUTER_DATA = resp.json().get("services", {})
                print("✅ Router data cached.")
            else:
                _ROUTER_DATA = {} 
        except Exception:
            # Fallback: try unsuffixed 'router'
            try:
                router_url = subprocess.check_output([
                    "gcloud", "run", "services", "describe", "router",
                    "--platform", "managed", "--region", REGION, "--project", project_id,
                    "--format", "value(status.url)"
                ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
                resp = requests.get(f"{router_url}/router/services", timeout=5)
                if resp.status_code == 200:
                    _ROUTER_DATA = resp.json().get("services", {})
                    print("✅ Router data cached (via unsuffixed service).")
                else:
                    _ROUTER_DATA = {}
            except Exception:
                _ROUTER_DATA = {}

    # 2. Return from router data if available
    if service_name in _ROUTER_DATA and _ROUTER_DATA[service_name]:
        return _ROUTER_DATA[service_name]

    # 3. Fallback to slow gcloud discovery
    print(f"⚠️  {service_name} not in Router. Falling back to slow gcloud discovery...")
    project_id = get_project_id(env)
    
    if env == "dev":
        deploy_name = f"{service_name}-dev"
    elif env == "test":
        deploy_name = f"{service_name}-test"
    elif env == "prod":
        deploy_name = f"{service_name}-prod"
    else:
        deploy_name = service_name
        
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name,
            "--platform", "managed", "--region", REGION, "--project", project_id,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
        return url
    except Exception:
        # Fallback: try unsuffixed name
        try:
            url = subprocess.check_output([
                "gcloud", "run", "services", "describe", service_name,
                "--platform", "managed", "--region", REGION, "--project", project_id,
                "--format", "value(status.url)"
            ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
            return url
        except Exception:
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

    # Tag cache: maps (category, name) -> {id, category, name, slug, status}
    tag_cache = {}

    def resolve_tag(category, name):
        """Create or find a tag and return its ProfileTag dict."""
        key = (category.lower(), name.strip())
        if key in tag_cache:
            return tag_cache[key]
        
        # POST /profiles/tags/ — idempotent; returns existing if match found
        resp = requests.post(
            f"{PROFILES_URL}/profiles/tags/",
            json={"category": category, "name": name},
            headers=seeder_headers,
            timeout=30,
        )
        if resp.status_code in [200, 201]:
            t = resp.json()
            tag_obj = {
                "id": t["id"],
                "category": t["category"],
                "name": t["name"],
                "slug": t["slug"],
                "status": t["status"],
            }
            tag_cache[key] = tag_obj
            return tag_obj
        else:
            print(f"  ⚠️ Failed to resolve tag {category}/{name}: {resp.status_code} {resp.text}")
            return None

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
        
        # Resolve gender tag(s)
        gender_tags = []
        if row.get("gender") and row["gender"].strip():
            tag = resolve_tag("gender", row["gender"].strip())
            if tag:
                gender_tags.append(tag)

        profile_data = {
            "display_name": row["name"],
            "bio": row["bio"],
            "gender": gender_tags,
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

def verify_bucket_permissions(env):
    """Check that the GCS media bucket has public read access (allUsers objectViewer)."""
    project = get_project_id(env)
    bucket_name = f"{project}-media-{env}"
    print(f"\n🔍 Verifying GCS bucket permissions for {bucket_name}...")
    try:
        result = subprocess.run(
            ["gcloud", "storage", "buckets", "get-iam-policy", f"gs://{bucket_name}", "--format=json"],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode != 0:
            print(f"  ⚠️ Could not check bucket {bucket_name}: {result.stderr.strip()}")
            return

        import json as _json
        policy = _json.loads(result.stdout)
        bindings = policy.get("bindings", [])
        has_public = any(
            "allUsers" in b.get("members", []) and b.get("role") == "roles/storage.objectViewer"
            for b in bindings
        )
        if has_public:
            print(f"  ✅ {bucket_name} has public read access (allUsers).")
        else:
            print(f"  ❌ WARNING: {bucket_name} is MISSING allUsers objectViewer! Images will NOT be publicly accessible.")
            print(f"     Fix with: gcloud storage buckets add-iam-policy-binding gs://{bucket_name} --member=allUsers --role=roles/storage.objectViewer")
    except Exception as e:
        print(f"  ⚠️ Could not verify bucket permissions: {e}")

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
    verify_bucket_permissions(env)
