import httpx
import asyncio
import os
import sys

# Configuration
AUTH_URL = "https://auth-test-hhqol7siba-uc.a.run.app"
PROFILES_URL = "https://profiles-test-hhqol7siba-uc.a.run.app"
EMAIL = "valerius_demo_recorded@example.com"
PASSWORD = "Password123!"

SAMPLE_PROFILES_DIR = "sample profiles"
IMAGE_FILES = [
    "1f2ee97a-1bce-4da8-abe8-e5ae8c429868.jpg",
    "2bbfac57-b369-1ad6-edc7-d7fc29b9c651.jpeg",
    "2d799bbf-e43b-46ed-a48b-7a93629cef22.jpeg",
    "2dff66ec-c121-7164-b339-87fce85af7e0.jpeg",
    "42f61adf-86ee-417f-a535-304aa4c50f94.jpeg",
    "4d7e7069-5a8f-44cb-88c6-dbeece1e4caa.jpg"
]

async def populate():
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Login
        print(f"🔑 Logging in as {EMAIL}...")
        login_res = await client.post(f"{AUTH_URL}/auth/login", json={"email": EMAIL, "password": PASSWORD})
        if login_res.status_code != 200:
            print(f"❌ Login failed: {login_res.text}")
            return
        
        auth_data = login_res.json()
        token = auth_data["id_token"]
        uid = auth_data["uid"]
        headers = {"Authorization": f"Bearer {token}"}
        print(f"✅ Logged in. UID: {uid}")

        # 2. Get Profile ID
        print("🔍 Fetching profiles...")
        profiles_res = await client.get(f"{PROFILES_URL}/profiles/user/{uid}", headers=headers)
        if profiles_res.status_code != 200:
            print(f"❌ Failed to fetch profiles: {profiles_res.text}")
            return
        
        profiles = profiles_res.json()
        valerius_profile = next((p for p in profiles if p["display_name"] == "Valerius the Bold"), None)
        
        if not valerius_profile:
            print("❌ Valerius the Bold profile not found. Please create it first in the UI.")
            return
        
        profile_id = valerius_profile["profile_id"]
        print(f"✅ Found profile: {profile_id}")

        # 3. Upload Images
        for i, img_name in enumerate(IMAGE_FILES):
            img_path = os.path.join(SAMPLE_PROFILES_DIR, img_name)
            if not os.path.exists(img_path):
                print(f"⚠️ Warning: Image {img_path} not found, skipping.")
                continue
            
            print(f"🖼️ Uploading image {i+1}/6: {img_name}...")
            with open(img_path, "rb") as f:
                files = {"file": (img_name, f, "image/jpeg")}
                upload_res = await client.post(
                    f"{PROFILES_URL}/profiles/{profile_id}/image?index={i}",
                    headers=headers,
                    files=files
                )
            
            if upload_res.status_code == 200:
                print(f"✅ Uploaded {img_name} to index {i}")
            else:
                print(f"❌ Failed to upload {img_name}: {upload_res.text}")

        print("\n🎉 Profile population complete!")

if __name__ == "__main__":
    asyncio.run(populate())
