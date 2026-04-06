import requests
import subprocess
import uuid

# Configuration
PROJECT_ID = "tavern-swiper-dev"
REGION = "us-central1"

def get_url(service_name, env="test"):
    deploy_name = f"{service_name}-test" if env == "test" else service_name
    return subprocess.check_output([
        "gcloud", "run", "services", "describe", deploy_name,
        "--platform", "managed", "--region", REGION, "--project", PROJECT_ID,
        "--format", "value(status.url)"
    ]).decode("utf-8").strip()

def verify_limit():
    print("🧪 Verifying Discovery Feed Limit...")
    
    auth_url = get_url("auth")
    discovery_url = get_url("discovery")
    profiles_url = get_url("profiles")
    users_url = get_url("users")
    
    # 1. Create a fresh test user
    email = f"limit-test-{uuid.uuid4().hex[:8]}@example.com"
    password = "Password123!"
    
    print(f"Registering {email}...")
    reg_resp = requests.post(f"{auth_url}/auth/register", json={"email": email, "password": password})
    reg_resp.raise_for_status()
    id_token = reg_resp.json()["id_token"]
    
    # 2. Get Tavern Token
    v_resp = requests.post(f"{auth_url}/auth/verify", json={"id_token": id_token})
    token = v_resp.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 3. Register in Users Service
    requests.post(f"{users_url}/users/", headers=headers, json={"email": email, "user_type": "user"})
    
    # 4. Create Profile
    print("Creating profile...")
    p_resp = requests.post(f"{profiles_url}/profiles/", headers=headers, json={"display_name": "Limit Tester"})
    p_resp.raise_for_status()
    profile_id = p_resp.json()["profile_id"]
    print(f"Created profile: {profile_id}")

    # 5. Test Limit = 1
    print("\n--- Testing Limit = 1 ---")
    feed_resp = requests.get(f"{discovery_url}/discovery/feed/{profile_id}?limit=1", headers=headers)
    feed_resp.raise_for_status()
    profiles = feed_resp.json()["profiles"]
    print(f"Received {len(profiles)} profiles.")
    assert len(profiles) <= 1, f"Expected 1 profile, got {len(profiles)}"
    
    # 6. Test Limit = 5
    print("\n--- Testing Limit = 5 ---")
    feed_resp = requests.get(f"{discovery_url}/discovery/feed/{profile_id}?limit=5", headers=headers)
    profiles = feed_resp.json()["profiles"]
    print(f"Received {len(profiles)} profiles.")
    assert len(profiles) <= 5, f"Expected <= 5 profiles, got {len(profiles)}"

    # 7. Test Default Limit (10)
    print("\n--- Testing Default Limit (10) ---")
    feed_resp = requests.get(f"{discovery_url}/discovery/feed/{profile_id}", headers=headers)
    profiles = feed_resp.json()["profiles"]
    print(f"Received {len(profiles)} profiles.")
    assert len(profiles) <= 10, f"Expected <= 10 profiles, got {len(profiles)}"

    print("\n✅ Discovery Limit verification complete!")

if __name__ == "__main__":
    verify_limit()
