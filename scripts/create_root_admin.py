import os
import sys
import requests
import json
import subprocess

# --- Configuration ---
REGION = "us-central1"

# Map environment names to GCP project IDs
PROJECT_MAP = {
    "local": "tavern-swiper-dev",
    "dev": "tavern-swiper-dev",
    "test": "tavern-swiper-dev",
    "prod": "tavern-swiper-prod",
}

def get_project_id(env):
    return PROJECT_MAP.get(env, "tavern-swiper-dev")

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
    
    project_id = get_project_id(env)
    deploy_name = f"{service_name}-{env}"
    region = REGION # Cloud Run services are in us-central1 for all envs
        
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name,
            "--platform", "managed", "--region", region, "--project", project_id,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
        return url
    except Exception:
        # Fallback: try unsuffixed name
        try:
            url = subprocess.check_output([
                "gcloud", "run", "services", "describe", service_name,
                "--platform", "managed", "--region", region, "--project", project_id,
                "--format", "value(status.url)"
            ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
            return url
        except Exception:
            return None

def create_root(env="local", email="root@tavernswiper.com", password="Password123!"):
    print(f"🚀 Creating Root Admin in {env} environment (project: {get_project_id(env)})...")
    
    auth_url = get_url("auth", env)
    users_url = get_url("users", env)
    
    if not all([auth_url, users_url]):
        print("❌ Could not determine all service URLs.")
        print(f"  Auth: {auth_url}")
        print(f"  Users: {users_url}")
        return

    # 1. Register or Login
    print(f"Authenticating: {email}...")
    payload = {"email": email, "password": password}
    
    resp = requests.post(f"{auth_url}/auth/login", json=payload)
    if resp.status_code == 200:
        print("✅ Logged in existing user.")
    else:
        resp = requests.post(f"{auth_url}/auth/register", json=payload)
        if resp.status_code == 200:
            print("✅ Registered new user.")
        else:
            print(f"❌ Auth failed: {resp.text}")
            return

    id_token = resp.json()["id_token"]
    uid = resp.json()["uid"]

    # 2. Verify/Exchange for Tavern JWT
    print("Exchanging for Tavern JWT...")
    v_resp = requests.post(f"{auth_url}/auth/verify", json={"id_token": id_token})
    if v_resp.status_code != 200:
        print(f"❌ Verification failed: {v_resp.text}")
        return
    
    tavern_token = v_resp.json()["token"]
    u_headers = {"Authorization": f"Bearer {tavern_token}"}

    # 3. Bootstrap as Root Admin in Users Service
    print("Bootstrapping Root Admin status...")
    u_payload = {
        "email": email,
        "user_type": "root_admin",
        "full_name": "System Root Admin"
    }
    
    u_resp = requests.post(f"{users_url}/users/", json=u_payload, headers=u_headers)
    if u_resp.status_code in [200, 201]:
        print("✅ Root Admin record created/confirmed.")
    elif u_resp.status_code == 400 and "root admin already exists" in u_resp.text.lower():
        print("ℹ️ Root admin already exists in Users service.")
    else:
        print(f"❌ User creation failed: {u_resp.status_code} - {u_resp.text}")
        sys.exit(1)

    # 4. Refresh Token (to get the new role in the JWT)
    print("Refreshing Tavern JWT to pick up Root Admin role...")
    v_resp = requests.post(f"{auth_url}/auth/verify", json={"id_token": id_token})
    if v_resp.status_code != 200:
        print(f"❌ Token refresh failed: {v_resp.text}")
        return
    tavern_token = v_resp.json()["token"]
    u_headers = {"Authorization": f"Bearer {tavern_token}"}


    # Final Summary
    print("\n" + "="*50)
    print("🌟 ROOT ADMIN READY 🌟")
    print(f"UID: {uid}")
    print(f"Email: {email}")
    print("\nUse this Tavern JWT for API requests:")
    print(f"Bearer {tavern_token}")
    print("="*50)

if __name__ == "__main__":
    env = "dev"
    if len(sys.argv) > 1:
        env = sys.argv[1]
    
    if env not in PROJECT_MAP:
        print(f"❌ Unknown environment: {env}. Valid options: {list(PROJECT_MAP.keys())}")
        sys.exit(1)
    
    email = os.getenv("ROOT_EMAIL", "root@tavernswiper.com")
    password = os.getenv("ROOT_PASSWORD", "Password123!")
    
    create_root(env, email, password)
