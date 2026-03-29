import requests
import sys

# --- Configuration ---
# Admin Credentials (must be Root Admin for full purge)
ADMIN_EMAIL = "seeder@example.com"
ADMIN_PASSWORD = "Password123!" # Assuming standard test password

SERVICES = {
    "Messages": "https://messages-374390417125.us-central1.run.app",
    "Swipes": "https://swipes-374390417125.us-central1.run.app",
    "Profiles": "https://profiles-374390417125.us-central1.run.app",
    "Users": "https://users-374390417125.us-central1.run.app",
    "Auth": "https://auth-374390417125.us-central1.run.app"
}

def get_auth_token():
    print(f"Logging in as {ADMIN_EMAIL}...")
    # Using the Auth service directly to get a token
    resp = requests.post(f"{SERVICES['Auth']}/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    if resp.status_code == 200:
        return resp.json()["id_token"]
    raise Exception(f"Failed to authenticate: {resp.text}")

def clear_all():
    print("WARNING: This will permanently delete ALL data in the Tavern Swiper environment.")
    confirm = input("Are you absolutely sure? (type 'YES' to confirm): ")
    if confirm != "YES":
        print("Abort.")
        return

    try:
        token = get_auth_token()
    except Exception as e:
        print(f"Error: {e}")
        return

    headers = {"Authorization": f"Bearer {token}"}

    # Order matters: Detailed data first, then identities
    purge_order = [
        ("Messages", f"{SERVICES['Messages']}/messages/"),
        ("Swipes", f"{SERVICES['Swipes']}/swipes/"),
        ("Profiles", f"{SERVICES['Profiles']}/profiles/"),
        ("Users", f"{SERVICES['Users']}/users/"),
        ("Auth", f"{SERVICES['Auth']}/auth/all")
    ]

    for name, url in purge_order:
        print(f"Purging {name} database...")
        resp = requests.delete(url, headers=headers)
        if resp.status_code in [204, 200]:
            print(f"✅ {name} database cleared.")
        else:
            print(f"❌ Failed to clear {name}: {resp.status_code} - {resp.text}")

    print("\nSystem-wide purge complete!")

if __name__ == "__main__":
    clear_all()
