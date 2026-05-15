"""
Update all bot users to user_type='bot' in the users Firestore database.

1. Authenticates as root admin, lists all bots from the bots API to get firebase_uids.
2. Directly updates each user doc in Firestore (users-{env}) to set user_type='bot'.

Usage:
    .venv/bin/python3 scripts/update_bot_user_types.py <env>
    env: dev | test | prod
"""

import sys
import os
import asyncio
import httpx
import subprocess
import json
import base64
from google.cloud import firestore

PROJECT_MAP = {
    "dev": "tavern-swiper-dev",
    "test": "tavern-swiper-dev",
    "prod": "tavern-swiper-prod",
}
REGION = "us-central1"


def get_router_url(env: str) -> str:
    project = PROJECT_MAP.get(env)
    if not project:
        print(f"❌ Unknown environment: {env}")
        sys.exit(1)
    try:
        return subprocess.check_output([
            "gcloud", "run", "services", "describe", f"router-{env}",
            "--platform", "managed", "--region", REGION, "--project", project,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
    except Exception:
        print(f"❌ Could not resolve router URL for {env}")
        sys.exit(1)


async def fetch_urls(env: str) -> dict:
    router_url = get_router_url(env)
    print(f"📡 Router: {router_url}")
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{router_url}/router/services")
        resp.raise_for_status()
        return resp.json()["services"]


async def get_root_token(auth_url: str, users_url: str) -> str:
    creds = [
        (os.getenv("ROOT_EMAIL", "root@tavernswiper.com"), os.getenv("ROOT_PASSWORD", "Password123!")),
        ("root@example.com", "TestPassword123!"),
    ]
    async with httpx.AsyncClient(timeout=30.0) as client:
        for email, password in creds:
            r = await client.post(f"{auth_url}/auth/login", json={"email": email, "password": password})
            if r.status_code != 200:
                continue
            id_token = r.json()["id_token"]
            v = await client.post(f"{auth_url}/auth/verify", json={"id_token": id_token})
            if v.status_code != 200:
                continue
            token = v.json()["token"]
            payload = token.split(".")[1]
            payload += "=" * (4 - len(payload) % 4)
            role = json.loads(base64.urlsafe_b64decode(payload)).get("role", "")
            if role in ("admin", "root_admin"):
                print(f"  ✅ Authenticated as {email} (role={role})")
                return token
    raise Exception("Could not obtain an admin token")


async def main():
    if len(sys.argv) != 2:
        print("Usage: .venv/bin/python3 scripts/update_bot_user_types.py <env>")
        sys.exit(1)

    env = sys.argv[1]
    project = PROJECT_MAP.get(env)
    print(f"🚀 Updating bot user types in [{env}] (project={project})")

    # Step 1: Get all bot firebase_uids from bots API
    urls = await fetch_urls(env)
    print("🔐 Authenticating Root Admin...")
    token = await get_root_token(urls["auth"], urls["users"])
    headers = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{urls['bots']}/bots/", headers=headers)
        resp.raise_for_status()
        bots = resp.json()

    print(f"\n📋 Found {len(bots)} bot(s):")
    uids = []
    for bot in bots:
        uid = bot.get("firebase_uid", "")
        slug = bot.get("slug", "")
        email = bot.get("email", "")
        print(f"  • {slug}: firebase_uid={uid}, email={email}")
        if uid:
            uids.append((uid, slug, email))

    if not uids:
        print("❌ No bot UIDs found. Nothing to update.")
        return

    # Step 2: Direct Firestore update on users-{env} database
    db_id = f"users-{env}"
    print(f"\n🔥 Connecting to Firestore database: {db_id} (project={project})")
    db = firestore.Client(project=project, database=db_id)

    for uid, slug, email in uids:
        doc_ref = db.collection("users").document(uid)
        print(f"\n  Updating {slug} (uid={uid})...")
        doc_ref.set({"user_type": "bot"}, merge=True)
        print(f"  ✅ Set user_type='bot' for {uid}")

    # Verify
    print("\n🔍 Verifying updates:")
    for uid, slug, email in uids:
        doc = db.collection("users").document(uid).get()
        if doc.exists:
            data = doc.to_dict()
            print(f"  • {slug}: user_type={data.get('user_type')}, email={data.get('email')}")
        else:
            print(f"  • {slug}: ⚠️ Document {uid} does not exist!")

    print(f"\n🏁 Done!")


if __name__ == "__main__":
    asyncio.run(main())
