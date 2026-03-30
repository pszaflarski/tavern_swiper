import requests

# --- Configuration ---
AUTH_URL = "https://auth-test-hhqol7siba-uc.a.run.app"
SWIPES_URL = "https://swipes-test-hhqol7siba-uc.a.run.app"
USERS_URL = "https://users-test-hhqol7siba-uc.a.run.app"
ADMIN_EMAIL = "admin@e.com"
ADMIN_PASSWORD = "adminadmin"

def get_token(email, password):
    """Register or Login a user to get their token and UID."""
    print(f"Authenticating as {email}...")
    login_resp = requests.post(f"{AUTH_URL}/auth/login", json={"email": email, "password": password})
    if login_resp.status_code == 200:
        return login_resp.json()["id_token"], login_resp.json()["uid"]
    
    # Try register if login fails
    print("Login failed, attempting registration...")
    reg_resp = requests.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": password})
    if reg_resp.status_code == 200:
        return reg_resp.json()["id_token"], reg_resp.json()["uid"]
    
    raise Exception(f"Failed to auth {email}.\n  Login Error: {login_resp.text}\n  Register Error: {reg_resp.text}")

def reset_discovery():
    try:
        # 1. Get Admin Token and UID
        token, uid = get_token(ADMIN_EMAIL, ADMIN_PASSWORD)
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Elevate to Root Admin (Bootstrap)
        print("Elevating to Root Admin...")
        bootstrap_data = {
            "email": ADMIN_EMAIL,
            "user_type": "root_admin",
            "is_premium": True
        }
        requests.post(f"{USERS_URL}/users/", json=bootstrap_data, headers=headers)

        # 3. Call DELETE /swipes/
        print(f"Calling DELETE {SWIPES_URL}/swipes/ ...")
        resp = requests.delete(f"{SWIPES_URL}/swipes/", headers=headers)
        
        if resp.status_code == 204:
            print("✅ Discovery reset successfully! All swipes and matches cleared.")
        else:
            print(f"❌ Failed to reset discovery: {resp.status_code} - {resp.text}")

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    reset_discovery()
