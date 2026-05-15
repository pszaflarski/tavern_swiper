import requests
import os
import sys
import subprocess
import json
import time

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

# Admin account for seeding
ROOT_EMAIL = os.getenv("ROOT_EMAIL", "root@tavernswiper.com")
ROOT_PASSWORD = os.getenv("ROOT_PASSWORD", "Password123!")

SERVICES = ["auth", "profiles", "discovery", "messages", "users", "bots", "agent_router"]

def get_service_url(service_name, env="dev"):
    # Check for local overrides first
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
            "router": 8010,
        }
        return f"http://127.0.0.1:{ports.get(service_name)}"

    # Fetch from Cloud Run
    # Some services have a different Cloud Run deploy name than the router key
    deploy_name_map = {
        "agent_router": "agent-router",
    }
    base_name = deploy_name_map.get(service_name, service_name)
    env_suffix = ""
    if env == "dev":
        env_suffix = "-dev"
    elif env == "test":
        env_suffix = "-test"
    elif env == "prod":
        env_suffix = "-prod"
    
    deploy_name = f"{base_name}{env_suffix}"
    
    project_id = get_project_id(env)
    
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name,
            "--platform", "managed", "--region", REGION, "--project", project_id,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
        return url
    except Exception:
        # Try without suffix as fallback
        try:
            url = subprocess.check_output([
                "gcloud", "run", "services", "describe", base_name,
                "--platform", "managed", "--region", REGION, "--project", project_id,
                "--format", "value(status.url)"
            ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
            return url
        except Exception:
            return None

def get_admin_token(auth_url):
    """Login as root to get an admin token."""
    print(f"🔑 Authenticating as admin ({ROOT_EMAIL})...")
    try:
        resp = requests.post(f"{auth_url}/auth/login", json={
            "email": ROOT_EMAIL,
            "password": ROOT_PASSWORD
        }, timeout=10)
        if resp.status_code != 200:
            print(f"❌ Login failed: {resp.status_code} {resp.text}")
            return None
        
        id_token = resp.json().get("id_token")
        # Exchange for Tavern token
        v_resp = requests.post(f"{auth_url}/auth/verify", json={"id_token": id_token}, timeout=10)
        if v_resp.status_code != 200:
            print(f"❌ Tavern verification failed: {v_resp.status_code} {v_resp.text}")
            return None
        
        return v_resp.json().get("token")
    except Exception as e:
        print(f"❌ Error getting admin token: {e}")
        return None

def seed_routes(env="dev", target_tag="default"):
    print(f"🚀 Seeding router routes for env={env}, tag={target_tag}...")
    
    router_url = get_service_url("router", env)
    auth_url = get_service_url("auth", env)
    
    if not router_url:
        print("❌ Could not determine Router URL.")
        return
    if not auth_url:
        print("❌ Could not determine Auth URL.")
        return
    
    print(f"📍 Router URL: {router_url}")
    print(f"📍 Auth URL:   {auth_url}")
    
    token = get_admin_token(auth_url)
    if not token:
        print("❌ Could not get admin token. Skipping seed.")
        return
    
    headers = {"Authorization": f"Bearer {token}"}
    
    for service in SERVICES:
        url = get_service_url(service, env)
        if not url:
            print(f"⚠️  Could not find URL for service: {service}. Skipping.")
            continue
            
        print(f"📡 Registering {service} -> {url} (tag: {target_tag})...")
        resp = requests.put(
            f"{router_url}/router/services/{service}",
            json={"tag": target_tag, "url": url},
            headers=headers,
            timeout=10
        )
        
        if resp.status_code == 200:
            print(f"✅ Successfully registered {service}")
        else:
            print(f"❌ Failed to register {service}: {resp.status_code} {resp.text}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Seed the Router service with Cloud Run URLs.")
    parser.add_argument("--env", default="dev", choices=["local", "dev", "test", "prod"], help="Target environment")
    parser.add_argument("--tag", default="default", help="Tag to apply to the routes")
    
    args = parser.parse_args()
    seed_routes(args.env, args.tag)
