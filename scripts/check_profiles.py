import requests
import os
import subprocess

def get_url(service):
    return subprocess.check_output([
        "gcloud", "run", "services", "describe", f"{service}-test", 
        "--format=value(status.url)", "--region=us-central1"
    ]).decode("utf-8").strip()

AUTH_URL = get_url("auth")
PROFILES_URL = get_url("profiles")

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
