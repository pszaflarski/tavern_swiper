import requests
import csv
import os
import time

# Primary Seeder (Already elevated to Admin/RootAdmin in database)
SEEDER_EMAIL = "admin@e.com"
SEEDER_PASSWORD = "adminadmin"

# --- Configuration ---
AUTH_URL = "https://auth-test-hhqol7siba-uc.a.run.app"
PROFILES_URL = "https://profiles-test-hhqol7siba-uc.a.run.app"
USERS_URL = "https://users-test-hhqol7siba-uc.a.run.app"
CSV_PATH = "sample_profiles/profiles.csv"
SAMPLE_IMAGES_DIR = "sample_profiles"

def get_token(email, password):
    """Register or Login a user to get their token and UID."""
    login_resp = requests.post(f"{AUTH_URL}/auth/login", json={"email": email, "password": password})
    if login_resp.status_code == 200:
        return login_resp.json()["id_token"], login_resp.json()["uid"]
    
    # Try register if login fails
    reg_resp = requests.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": password})
    if reg_resp.status_code == 200:
        return reg_resp.json()["id_token"], reg_resp.json()["uid"]
    
    raise Exception(f"Failed to auth {email}.\n  Login Error: {login_resp.text}\n  Register Error: {reg_resp.text}")

def seed_system():
    # 1. Login as primary seeder
    print(f"Authenticating primary seeder: {SEEDER_EMAIL}...")
    seeder_token, seeder_uid = get_token(SEEDER_EMAIL, SEEDER_PASSWORD)
    seeder_headers = {"Authorization": f"Bearer {seeder_token}"}

    # 1b. Bootstrap: Ensure seeder is Root Admin (needed for user overrides)
    print("Elevating seeder to Root Admin for administrative seeding...")
    bootstrap_data = {
        "email": SEEDER_EMAIL,
        "user_type": "root_admin",
        "is_premium": True
    }
    # This will succeed if the DB is empty (singleton check in Users service) or return 200/201 if already exists
    b_resp = requests.post(f"{USERS_URL}/users/", json=bootstrap_data, headers=seeder_headers)
    if b_resp.status_code not in [200, 201]:
        print(f"Note: Seeder bootstrap status: {b_resp.status_code} ({b_resp.text})")

    # 2. Read CSV
    print(f"Reading {CSV_PATH}...")
    with open(CSV_PATH, mode='r') as f:
        rows = list(csv.DictReader(f))

    # 3. Setup Users & Roles
    user_map = {} # email -> {uid, token, role}
    for row in rows:
        email = row["email"]
        if email not in user_map:
            print(f"Setting up account: {email} ({row['user_role']})...")
            token, uid = get_token(email, row["password"])
            
            # Use SEEDER to set the role in the Users service
            user_data = {
                "uid": uid,
                "email": email,
                "user_type": row["user_role"],
                "is_premium": True
            }
            u_resp = requests.post(f"{USERS_URL}/users/", json=user_data, headers=seeder_headers)
            if u_resp.status_code not in [201, 200]:
                print(f"Warning: Could not set user record/role for {email}: {u_resp.text}")
            
            user_map[email] = {"uid": uid, "token": token, "role": row["user_role"]}

    # 4. Create Profiles
    for row in rows:
        email = row["email"]
        target_uid = user_map[email]["uid"]
        print(f"--- Seeding Profile: {row['name']} for {email} ---")
        
        profile_data = {
            "display_name": row["name"],
            "bio": row["bio"],
            "gender": row["gender"],
            "character_class": "Adventurer",
            "realm": "Sample",
            "talents": [],
            "attributes": {"strength": 10, "charisma": 10, "spark": 10},
            "user_id": target_uid # Administrative override!
        }
        
        resp = requests.post(f"{PROFILES_URL}/profiles/", json=profile_data, headers=seeder_headers)
        if resp.status_code != 201:
            print(f"Failed to create profile: {resp.text}")
            continue
        
        profile_id = resp.json()["profile_id"]
        print(f"Profile created: {profile_id}")

        # 5. Upload Images
        for i in range(1, 7):
            img_key = f"image_{i}"
            if row.get(img_key):
                img_filename = row[img_key]
                img_path = os.path.join(SAMPLE_IMAGES_DIR, img_filename)
                
                if os.path.exists(img_path) and img_filename:
                    print(f"Uploading {img_filename} to index {i-1}...")
                    with open(img_path, 'rb') as img_file:
                        files = {'file': (img_filename, img_file, 'image/jpeg')}
                        img_resp = requests.post(
                            f"{PROFILES_URL}/profiles/{profile_id}/image?index={i-1}",
                            headers=seeder_headers,
                            files=files
                        )
                        if img_resp.status_code == 200:
                            print(f"Successfully uploaded {img_filename}")
                        else:
                            print(f"Failed to upload {img_filename}: {img_resp.text}")

    print("\n✅ Multi-user seeding complete!")

if __name__ == "__main__":
    seed_system()
