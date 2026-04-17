import requests
import os
import subprocess

import sys

PROJECT_ID = "tavern-swiper-dev"
REGION = "us-central1"

def get_url(service, env="dev"):
    if env == "local":
        return f"http://localhost:{8001 if service == 'auth' else 8002}"
    
    deploy_name = f"{service}-test" if env == "test" else f"{service}-dev"
    if env != "test" and env != "dev":
        deploy_name = service

    try:
        return subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name, 
            "--format=value(status.url)", "--region=" + REGION, "--project=" + PROJECT_ID
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
    except Exception:
        if env == "dev":
            print(f"⚠️  Suffixed service {deploy_name} not found. Falling back to unsuffixed: {service}")
            try:
                return subprocess.check_output([
                    "gcloud", "run", "services", "describe", service, 
                    "--format=value(status.url)", "--region=" + REGION, "--project=" + PROJECT_ID
                ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
            except Exception:
                return None
        return None

if __name__ == "__main__":
    env = "dev"
    if len(sys.argv) > 1:
        env = sys.argv[1]

    AUTH_URL = get_url("auth", env)
    PROFILES_URL = get_url("profiles", env)
    
    if not AUTH_URL or not PROFILES_URL:
        print(f"❌ Could not find URLs for {env} environment.")
        sys.exit(1)

def get_token(email, password):
    login_resp = requests.post(f"{AUTH_URL}/auth/login", json={"email": email, "password": password})
    if login_resp.status_code == 200:
        id_token = login_resp.json()["id_token"]
        v_resp = requests.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token})
        if v_resp.status_code == 200:
            return v_resp.json()["token"], v_resp.json()["uid"]
    return None, None

token, uid = get_token("user@example.com", "Password123!")
if token:
    print(f"UID: {uid}")
    res = requests.get(f"{PROFILES_URL}/profiles/user/{uid}", headers={"Authorization": f"Bearer {token}"})
    print(f"Profiles: {res.json()}")
else:
    print("Failed to get token")
