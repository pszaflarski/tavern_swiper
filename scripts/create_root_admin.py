import os
import sys
import requests
import json
import subprocess

# --- Configuration ---
# Targets the test environment by default if "test" is passed as an argument.
# Otherwise targets local.
PROJECT_ID = "tavern-swiper-dev"
REGION = "us-central1"

def get_url(service_name, env="local"):
    # Check for explicit environment variable overrides
    env_var = "AUTH_URL" if service_name == "auth" else "USERS_URL"
    if os.getenv(env_var):
        return os.getenv(env_var)

    if env == "local":
        ports = {
            "auth": 8001,
            "users": 8006,
        }
        return f"http://localhost:{ports.get(service_name)}"
    
    # Fetch from Cloud Run
    deploy_name = f"{service_name}-test" if env == "test" else service_name
    # For 'dev', we use the service name directly. For 'test', we use the -test suffix.
    # The logic above already handles this implicitly if env == 'dev', but I'll make it explicit.
    if env == "dev":
        deploy_name = service_name
    elif env == "test":
        deploy_name = f"{service_name}-test"
        
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name,
            "--platform", "managed", "--region", REGION, "--project", PROJECT_ID,
            "--format", "value(status.url)"
        ]).decode("utf-8").strip()
        return url
    except Exception as e:
        print(f"⚠️ Error fetching URL for {deploy_name}: {e}")
        return None

def create_root(env="local", email="admin@example.com", password="Password123!"):
    print(f"🚀 Creating Root Admin in {env} environment...")
    
    auth_url = get_url("auth", env)
    users_url = get_url("users", env)
    
    if not auth_url or not users_url:
        print("❌ Could not determine service URLs.")
        return

    # 1. Register or Login
    print(f"Authenticating: {email}...")
    headers = {"Content-Type": "application/json"}
    payload = {"email": email, "password": password}
    
    # Try login first
    resp = requests.post(f"{auth_url}/auth/login", json=payload)
    if resp.status_code == 200:
        print("✅ Logged in existing user.")
    else:
        # Try register
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
    
    # 3. Bootstrap as Root Admin in Users Service
    print("Bootstrapping Root Admin status...")
    u_headers = {"Authorization": f"Bearer {tavern_token}"}
    u_payload = {
        "email": email,
        "user_type": "root_admin",
        "full_name": "System Root Admin"
    }
    
    u_resp = requests.post(f"{users_url}/users/", json=u_payload, headers=u_headers)
    if u_resp.status_code in [200, 201]:
        print("✅ Root Admin record created/confirmed.")
    elif u_resp.status_code == 400 and "root admin already exists" in u_resp.text.lower():
        print(f"❌ Error: A root admin already exists in the {env} environment.")
        sys.exit(1)
    else:
        print(f"❌ User creation failed: {u_resp.status_code} - {u_resp.text}")
        sys.exit(1)

    # Final Summary
    print("\n" + "="*50)
    print("🌟 ROOT ADMIN READY 🌟")
    print(f"UID: {uid}")
    print(f"Email: {email}")
    print("\nUse this Tavern JWT for API requests:")
    print(f"Bearer {tavern_token}")
    print("="*50)

if __name__ == "__main__":
    env = "local"
    if len(sys.argv) > 1:
        if sys.argv[1] in ["test", "dev"]:
            env = sys.argv[1]
    
    email = os.getenv("ROOT_EMAIL", "root@example.com")
    password = os.getenv("ROOT_PASSWORD", "Password123!")
    
    create_root(env, email, password)
