import os
import sys
import requests
import subprocess
import re

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
            "users": 8006,
        }
        return f"http://localhost:{ports.get(service_name)}"
    
    project_id = get_project_id(env)
    
    # 1. Try querying the Router first (fastest)
    deploy_name_router = f"router-{env}" if env != "dev" else "router-dev"
    try:
        router_url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name_router,
            "--platform", "managed", "--region", REGION, "--project", project_id,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
        
        resp = requests.get(f"{router_url}/router/services", timeout=5)
        if resp.status_code == 200:
            services = resp.json().get("services", {})
            if service_name in services and services[service_name]:
                return services[service_name]
    except Exception:
        pass

    # 2. Fallback to slow gcloud service describe
    deploy_name = f"{service_name}-{env}"
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name,
            "--platform", "managed", "--region", REGION, "--project", project_id,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
        return url
    except Exception:
        # Fallback: try unsuffixed name for dev
        try:
            url = subprocess.check_output([
                "gcloud", "run", "services", "describe", service_name,
                "--platform", "managed", "--region", REGION, "--project", project_id,
                "--format", "value(status.url)"
            ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
            return url
        except Exception:
            return None

def load_env(env):
    """Load credentials from the environment-specific .env file."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    env_file = os.path.join(script_dir, f".env.{env}")
    
    if not os.path.exists(env_file):
        print(f"❌ Env file not found: {env_file}")
        sys.exit(1)
        
    creds = {}
    with open(env_file, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            match = re.match(r"^([^=]+)=(.*)$", line)
            if match:
                key, val = match.groups()
                creds[key.strip()] = val.strip()
                
    return creds.get("BOT_EMAIL"), creds.get("BOT_PASSWORD")

def register_bot(env):
    print(f"🚀 Initializing registration for bot in '{env}' environment...")
    
    email, password = load_env(env)
    if not email or not password:
        print("❌ Could not load BOT_EMAIL or BOT_PASSWORD from env file.")
        sys.exit(1)
        
    auth_url = get_url("auth", env)
    users_url = get_url("users", env)
    
    if not auth_url or not users_url:
        print("❌ Could not determine service URLs.")
        print(f"  Auth: {auth_url}")
        print(f"  Users: {users_url}")
        sys.exit(1)
        
    print(f"📍 Auth URL: {auth_url}")
    print(f"📍 Users URL: {users_url}")
    print(f"✉️ Email: {email}")
    
    # 1. Register
    payload = {"email": email, "password": password}
    print("Attempting to register bot user...")
    
    reg_resp = requests.post(f"{auth_url}/auth/register", json=payload, timeout=30)
    
    id_token = None
    uid = None
    
    if reg_resp.status_code == 200:
        print("✅ Successfully registered new bot user.")
        id_token = reg_resp.json().get("id_token")
        uid = reg_resp.json().get("uid")
    elif reg_resp.status_code in [400, 401, 409] or "email already exists" in reg_resp.text.lower():
        print("ℹ️ User registration returned error (possibly already exists). Attempting login...")
        login_resp = requests.post(f"{auth_url}/auth/login", json=payload, timeout=30)
        if login_resp.status_code == 200:
            print("✅ Successfully logged in existing bot user.")
            id_token = login_resp.json().get("id_token")
            uid = login_resp.json().get("uid")
        else:
            print(f"❌ Login failed: {login_resp.status_code} - {login_resp.text}")
            sys.exit(1)
    else:
        print(f"❌ Registration failed: {reg_resp.status_code} - {reg_resp.text}")
        sys.exit(1)
        
    if not id_token or not uid:
        print("❌ Failed to obtain ID token or UID.")
        sys.exit(1)
        
    # 2. Verify / Exchange for Tavern JWT
    print("Exchanging Firebase ID token for Tavern JWT...")
    verify_resp = requests.post(f"{auth_url}/auth/verify", json={"id_token": id_token}, timeout=30)
    if verify_resp.status_code != 200:
        print(f"❌ Tavern token verification failed: {verify_resp.status_code} - {verify_resp.text}")
        sys.exit(1)
        
    tavern_token = verify_resp.json().get("token")
    print("✅ Successfully acquired Tavern JWT.")
    
    # 3. Call Users/me to self-heal/auto-initialize user record
    print("Verifying/initializing user record in Users database...")
    headers = {"Authorization": f"Bearer {tavern_token}"}
    me_resp = requests.get(f"{users_url}/users/me", headers=headers, timeout=30)
    
    if me_resp.status_code == 200:
        print("✅ Bot user record verified/initialized in Users database.")
        print(f"UID: {uid}")
        print(f"Email: {email}")
        print(f"Role: {me_resp.json().get('user_type')}")
    else:
        print(f"❌ Failed to verify user record: {me_resp.status_code} - {me_resp.text}")
        sys.exit(1)

    print("\n" + "="*60)
    print("🌟 BOT USER INITIALIZED SUCCESSFULLY 🌟")
    print(f"Environment: {env}")
    print(f"UID:         {uid}")
    print(f"Email:       {email}")
    print(f"Tavern JWT:  {tavern_token[:20]}... (use for authorization)")
    print("="*60 + "\n")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 register_bot.py [local|dev|test|prod]")
        sys.exit(1)
        
    env_arg = sys.argv[1].lower()
    if env_arg not in PROJECT_MAP:
        print(f"❌ Unknown environment: {env_arg}. Choose from: {list(PROJECT_MAP.keys())}")
        sys.exit(1)
        
    if env_arg == "prod":
        print("⚠️ WARNING: This command will modify the PRODUCTION environment.")
        confirm = input("Are you sure you want to proceed with Prod? (yes/no): ").strip().lower()
        if confirm != "yes":
            print("Operation cancelled.")
            sys.exit(0)
            
    register_bot(env_arg)
