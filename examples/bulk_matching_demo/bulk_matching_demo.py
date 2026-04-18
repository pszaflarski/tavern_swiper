import requests
import time
import json
import sys
import os
import csv
import random
import argparse

# Configurations
# Mint tokens from local auth (which must have ALLOW_LONG_LIVED_TOKENS=true)
AUTH_URL = os.getenv("AUTH_URL", "http://localhost:8001/auth")
# These can be local or cloud URLs
USERS_URL = os.getenv("USERS_URL", "http://localhost:8006/users")
PROFILES_URL = os.getenv("PROFILES_URL", "http://localhost:8002/profiles")
DISCOVERY_URL = os.getenv("DISCOVERY_URL", "http://localhost:8003/discovery")

# Robust pathing for sample profiles
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "../../"))
DEFAULT_CSV_PATH = os.path.join(PROJECT_ROOT, "sample_profiles/profiles.csv")
CSV_PATH = os.getenv("CSV_PATH", DEFAULT_CSV_PATH)

def mint_token(uid, email, role="user"):
    print(f"   [Auth] Minting Dev Token for {email}...")
    resp = requests.post(f"{AUTH_URL}/dev-mint", json={
        "uid": uid,
        "email": email,
        "role": role
    })
    resp.raise_for_status()
    return resp.json()['token']

def hydrate_user(token):
    print(f"   [Users] Triggering self-healing hydration...")
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{USERS_URL}/me", headers=headers)
    resp.raise_for_status()
    data = resp.json()
    print(f"   [Users] Account active: {data['uid']}")
    return data

def create_profile(token, row):
    print(f"   [Profiles] Creating profile for {row['name']}...")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Extract images
    image_urls = []
    for i in range(1, 7):
        img = row.get(f"image_{i}")
        if img and img.strip():
            # In a real scenario, these would be GS URLs. 
            # For testing, we just use the filenames as placeholders if they aren't URLs.
            url = img if img.startswith("http") else f"https://storage.googleapis.com/test-bucket/{img}"
            image_urls.append(url)

    resp = requests.post(f"{PROFILES_URL}/", headers=headers, json={
        "display_name": row["name"],
        "tagline": "Adventurer from sample profiles",
        "bio": row["bio"],
        "gender": row["gender"],
        "image_urls": image_urls
    })
    resp.raise_for_status()
    data = resp.json()
    print(f"   [Profiles] Created profile_id: {data['profile_id']}")
    return data['profile_id']

def swipe(token, swiper_id, swiped_id, direction="right"):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(f"{DISCOVERY_URL}/swipe/", headers=headers, json={
        "swiper_profile_id": swiper_id,
        "swiped_profile_id": swiped_id,
        "direction": direction
    })
    resp.raise_for_status()
    return resp.json().get('match_id')

def verify_match(token, match_id):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{DISCOVERY_URL}/matches/{match_id}", headers=headers)
    resp.raise_for_status()
    return resp.json()

def load_profiles():
    if not os.path.exists(CSV_PATH):
        print(f"❌ Error: CSV file not found at {CSV_PATH}")
        sys.exit(1)
    
    with open(CSV_PATH, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        return list(reader)

def run_iteration(iteration, p1_data, p2_data):
    print(f"\n--- 🔄 Iteration {iteration}: {p1_data['name']} ❤️ {p2_data['name']} ---")
    
    # Generate stable UIDs based on email to avoid collision but keep them predictable
    uid1 = f"bulk-user-{p1_data['name'].lower().replace(' ', '-')}"
    uid2 = f"bulk-user-{p2_data['name'].lower().replace(' ', '-')}"

    # Setup User 1
    t1 = mint_token(uid1, p1_data['email'], p1_data['user_role'])
    hydrate_user(t1)
    pid1 = create_profile(t1, p1_data)

    # Setup User 2
    t2 = mint_token(uid2, p2_data['email'], p2_data['user_role'])
    hydrate_user(t2)
    pid2 = create_profile(t2, p2_data)

    print("   [System] Waiting 3s for Pub/Sub sync...")
    time.sleep(3)

    # Duel Swiping
    print(f"   [Discovery] {p1_data['name']} swipes RIGHT...")
    swipe(t1, pid1, pid2, "right")

    print(f"   [Discovery] {p2_data['name']} swipes RIGHT...")
    matched_id = swipe(t2, pid2, pid1, "right")

    if matched_id:
        print(f"   ✅ MATCH CREATED: {matched_id}")
        verify_match(t1, matched_id)
    else:
        print("   ❌ FAILED: No match ID returned!")

def main():
    parser = argparse.ArgumentParser(description="Bulk Matching Demo")
    parser.add_argument("--count", type=int, default=10, help="Number of match iterations to perform")
    args = parser.parse_args()

    print(f"🚀 Starting Bulk Matching Demo ({args.count} iterations)")
    all_profiles = load_profiles()
    
    if len(all_profiles) < 2:
        print("❌ Error: Need at least 2 profiles in CSV to perform matching.")
        sys.exit(1)

    for i in range(1, args.count + 1):
        # Pick two random unique profiles
        pair = random.sample(all_profiles, 2)
        run_iteration(i, pair[0], pair[1])

    print(f"\n🎉 Finished {args.count} iterations of bulk matching demo.")

if __name__ == "__main__":
    main()
