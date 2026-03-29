import requests
import csv
import os
import time

# --- Configuration ---
AUTH_URL = "https://auth-374390417125.us-central1.run.app"
PROFILES_URL = "https://profiles-374390417125.us-central1.run.app"
USERS_URL = "https://users-374390417125.us-central1.run.app"
CSV_PATH = "sample profiles/profiles.csv"
SAMPLE_IMAGES_DIR = "sample profiles"

# Primary Seeder (Already elevated to Admin/RootAdmin in database)
SEEDER_EMAIL = "seeder@example.com"
SEEDER_PASSWORD = "Password123!"

def get_token(email, password):
    """Register or Login a user to get their token and UID."""
    resp = requests.post(f"{AUTH_URL}/auth/login", json={"email": email, "password": password})
    if resp.status_code == 200:
        return resp.json()["id_token"], resp.json()["uid"]
    
    # Try register if login fails
    resp = requests.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": password})
    if resp.status_code == 200:
        return resp.json()["id_token"], resp.json()["uid"]
    
    raise Exception(f"Failed to auth {email}: {resp.text}")

def seed_system():
    # 1. Login as primary seeder
    print(f"Authenticating primary seeder: {SEEDER_EMAIL}...")
    seeder_token, seeder_uid = get_token(SEEDER_EMAIL, SEEDER_PASSWORD)
    seeder_headers = {"Authorization": f"Bearer {seeder_token}"}

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
