import csv
import requests
import json
import os
import sys
from pathlib import Path

# --- Configuration ---
AUTH_URL = "https://auth-hhqol7siba-uc.a.run.app"
PROFILES_URL = "https://profiles-hhqol7siba-uc.a.run.app"
SAMPLE_DIR = Path("/home/peter/Documents/tavern_swiper/sample profiles")
CSV_PATH = SAMPLE_DIR / "profiles.csv"

def seed():
    if not CSV_PATH.exists():
        print(f"Error: {CSV_PATH} not found.")
        sys.exit(1)

    with open(CSV_PATH, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            email = f"{row['user_id']}@example.com"
            password = "Password123!"
            
            print(f"\n--- Processing user: {row['user_id']} ({row['name']}) ---")
            
            # 1. Register or Login
            token = None
            try:
                # Try register first
                resp = requests.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": password})
                if resp.status_code == 200:
                    print(f"Registered new user: {email}")
                    token = resp.json().get("id_token")
                else:
                    # Try login
                    resp = requests.post(f"{AUTH_URL}/auth/login", json={"email": email, "password": password})
                    if resp.status_code == 200:
                        print(f"Logged in existing user: {email}")
                        token = resp.json().get("id_token")
                    else:
                        print(f"Auth failed for {email}: {resp.text}")
                        continue
            except Exception as e:
                print(f"Request error during auth: {e}")
                continue

            if not token:
                continue

            headers = {"Authorization": f"Bearer {token}"}
            
            # 2. Create Profile
            # Note: We use some defaults for required fields not in CSV
            profile_payload = {
                "display_name": row["name"],
                "bio": row["bio"],
                "gender": row["gender"],
                "character_class": "Adventurer",
                "realm": "Fort Tavern",
                "talents": ["Exploring", "Tavern Gossiping"],
                "attributes": {"strength": 12, "charisma": 15, "spark": 8}
            }
            
            try:
                p_resp = requests.post(f"{PROFILES_URL}/profiles/", json=profile_payload, headers=headers)
                if p_resp.status_code == 201:
                    profile = p_resp.json()
                    p_id = profile["profile_id"]
                    print(f"Created profile ID: {p_id}")
                elif p_resp.status_code == 400 and "already exists" in p_resp.text.lower():
                    # If profile exists, we might need to GET it to find the ID, 
                    # but for seeding we usually assume fresh or we can just proceed if we had the ID.
                    # As a fallback, let's assume we need to list profiles for this user.
                    # However, to keep it simple, we'll just skip image upload if we can't get the ID.
                    print("Profile already exists. Skipping creation.")
                    # Let's try to fetch the profile ID
                    list_resp = requests.get(f"{PROFILES_URL}/profiles/me", headers=headers)
                    if list_resp.status_code == 200:
                        p_id = list_resp.json().get("profile_id")
                        print(f"Found existing profile ID: {p_id}")
                    else:
                        continue
                else:
                    print(f"Profile creation failed: {p_resp.text}")
                    continue
            except Exception as e:
                print(f"Request error during profile creation: {e}")
                continue

            # 3. Upload Images
            for i in range(1, 7):
                img_key = f"image_{i}"
                img_name = row.get(img_key)
                if not img_name or img_name.strip() == "":
                    continue
                
                img_path = SAMPLE_DIR / img_name
                if not img_path.exists():
                    print(f"  [!] Image file {img_name} not found at {img_path}")
                    continue
                
                print(f"  Uploading {img_name} to slot {i-1}...")
                try:
                    with open(img_path, "rb") as img_file:
                        files = {"file": (img_name, img_file, "image/jpeg")}
                        # Profiles service expects index in query param
                        upload_resp = requests.post(
                            f"{PROFILES_URL}/profiles/{p_id}/image?index={i-1}",
                            files=files,
                            headers=headers
                        )
                        if upload_resp.status_code == 200:
                            print(f"  [+] Slot {i-1} uploaded successfully.")
                        else:
                            print(f"  [-] Slot {i-1} upload failed: {upload_resp.text}")
                except Exception as e:
                    print(f"  [!] Upload error: {e}")

    print("\nSeeding complete!")

if __name__ == "__main__":
    seed()
