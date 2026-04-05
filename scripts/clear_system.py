import requests
import os
import time

# --- Configuration ---
# Targets the test environment by default
AUTH_URL = "https://auth-test-hhqol7siba-uc.a.run.app"
USERS_URL = "https://users-test-hhqol7siba-uc.a.run.app"
PROFILES_URL = "https://profiles-test-hhqol7siba-uc.a.run.app"
DISCOVERY_URL = "https://discovery-test-hhqol7siba-uc.a.run.app"
SWIPES_URL = "https://swipes-test-hhqol7siba-uc.a.run.app"
MESSAGES_URL = "https://messages-test-hhqol7siba-uc.a.run.app"

SEEDER_EMAIL = "peter@gmail.com"
SEEDER_PASSWORD = "Password123!"

def get_token(email, password):
    """Login or Register to get a token."""
    resp = requests.post(f"{AUTH_URL}/auth/login", json={"email": email, "password": password})
    if resp.status_code == 200:
        return resp.json()["id_token"]
    
    resp = requests.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": password})
    if resp.status_code == 200:
        return resp.json()["id_token"]
    
    raise Exception(f"Failed to auth: {resp.text}")

def purge_system():
    print(f"🚀 Starting API-Based System Purge for {SEEDER_EMAIL}\n")

    # 1. Get Seeder Token
    token = get_token(SEEDER_EMAIL, SEEDER_PASSWORD)
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Bootstrap Root Admin
    print("Ensuring Root Admin status...")
    bootstrap_data = {"email": SEEDER_EMAIL, "user_type": "root_admin", "is_premium": True}
    requests.post(f"{USERS_URL}/users/", json=bootstrap_data, headers=headers)
    
    # Simple wait for propagation
    time.sleep(2)

    # 3. Purge Services in Order
    services = [
        ("MESSAGES", MESSAGES_URL, "/messages/"),
        ("SWIPES", SWIPES_URL, "/swipes/"),
        ("PROFILES", PROFILES_URL, "/profiles/"),
        ("USERS", USERS_URL, "/users/"),
    ]

    for name, url, path in services:
        print(f"🗑️ Purging {name}...")
        resp = requests.delete(f"{url}{path}", headers=headers)
        if resp.status_code == 204:
            print(f"  ✅ {name} cleared.")
        else:
            print(f"  ❌ Error purging {name}: {resp.status_code} - {resp.text}")

    # 4. Final Blow: Purge Auth
    print("🔥 Final Step: Purging Auth Store...")
    resp = requests.delete(f"{AUTH_URL}/auth/all", headers=headers)
    if resp.status_code == 204:
        print("  ✅ Auth cleared.")
    else:
        print(f"  ❌ Error purging Auth: {resp.status_code} - {resp.text}")

    print("\n🏁 API-based system purge complete!")

if __name__ == "__main__":
    purge_system()
