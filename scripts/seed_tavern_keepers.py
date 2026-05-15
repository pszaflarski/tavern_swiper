import os
import sys
import asyncio
import httpx
import csv
import subprocess
import json as _json
import base64
from typing import Dict, Optional

# Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
CSV_PATH = os.path.join(PROJECT_ROOT, "services", "bots", "tavern_keepers.csv")

# Map environment names to GCP project IDs
PROJECT_MAP = {
    "dev": "tavern-swiper-dev",
    "test": "tavern-swiper-dev",
    "prod": "tavern-swiper-prod",
}

REGION = "us-central1"
BOT_SLUG_PREFIX = "tavern-keeper"


def get_router_url(env: str) -> str:
    """Dynamically resolve the router Cloud Run URL for any environment."""
    project = PROJECT_MAP.get(env)
    if not project:
        print(f"❌ Unknown environment: {env}. Valid: {list(PROJECT_MAP.keys())}")
        sys.exit(1)
    deploy_name = f"router-{env}"
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name,
            "--platform", "managed", "--region", REGION, "--project", project,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
        return url
    except Exception:
        print(f"❌ Could not resolve router URL for {env}")
        sys.exit(1)


async def fetch_urls(env: str) -> Dict[str, str]:
    router_url = get_router_url(env)
    print(f"📡 Router: {router_url}")
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{router_url}/router/services")
        resp.raise_for_status()
        urls = resp.json()["services"]
        print(f"✅ Routes fetched: {list(urls.keys())}")
        return urls


def decode_jwt_role(token: str) -> str:
    """Decode the role claim from a Tavern JWT without verification."""
    payload = token.split(".")[1]
    payload += "=" * (4 - len(payload) % 4)
    claims = _json.loads(base64.urlsafe_b64decode(payload))
    return claims.get("role", "")


async def get_root_token(auth_url: str, users_url: str) -> str:
    """Gets a root admin token. Tries standard creds, falls back to test creds."""
    cred_pairs = [
        (os.getenv("ROOT_EMAIL", "root@tavernswiper.com"), os.getenv("ROOT_PASSWORD", "Password123!")),
        ("root@example.com", "TestPassword123!"),
    ]

    async with httpx.AsyncClient(timeout=30.0) as client:
        for email, password in cred_pairs:
            # 1. Login or register
            login_resp = await client.post(f"{auth_url}/auth/login", json={"email": email, "password": password})
            if login_resp.status_code == 200:
                id_token = login_resp.json()["id_token"]
            else:
                reg_resp = await client.post(f"{auth_url}/auth/register", json={"email": email, "password": password})
                if reg_resp.status_code != 200:
                    continue
                id_token = reg_resp.json()["id_token"]

            # 2. Exchange for Tavern JWT
            v_resp = await client.post(f"{auth_url}/auth/verify", json={"id_token": id_token})
            if v_resp.status_code != 200:
                continue
            token = v_resp.json()["token"]

            # 3. Bootstrap root_admin in users service (idempotent)
            await client.post(
                f"{users_url}/users/",
                headers={"Authorization": f"Bearer {token}"},
                json={"email": email, "user_type": "root_admin", "full_name": "System Root Admin"}
            )

            # 4. Refresh token to pick up root_admin role
            v_resp2 = await client.post(f"{auth_url}/auth/verify", json={"id_token": id_token})
            if v_resp2.status_code != 200:
                continue
            final_token = v_resp2.json()["token"]

            role = decode_jwt_role(final_token)
            if role in ("admin", "root_admin"):
                print(f"  ✅ Authenticated as {email} (role={role})")
                return final_token
            else:
                print(f"  ⚠️ {email} has role={role}, trying next...")

    raise Exception("Could not obtain an admin token with any known credentials")


async def ensure_bot_user(client: httpx.AsyncClient, bots_url: str, headers: dict, slug: str) -> Optional[str]:
    """Register the shared tavern-keeper bot user, or find the existing one. Returns bot_id."""
    reg_resp = await client.post(
        f"{bots_url}/bots/",
        headers=headers,
        json={"slug": slug, "display_name": "Tavern Keeper"}
    )
    if reg_resp.status_code == 201:
        bot_id = reg_resp.json()["bot_id"]
        print(f"  Bot user registered: {bot_id} (slug={slug})")
        return bot_id
    elif reg_resp.status_code == 409:
        # Already exists — look it up
        list_resp = await client.get(f"{bots_url}/bots/", headers=headers)
        list_resp.raise_for_status()
        bot_entry = next((b for b in list_resp.json() if b["slug"] == slug), None)
        if bot_entry:
            print(f"  Bot user already exists: {bot_entry['bot_id']} (slug={slug})")
            return bot_entry["bot_id"]
        print(f"  ❌ Bot '{slug}' returned 409 but not found in list!")
        return None
    else:
        print(f"  ❌ Bot registration failed: {reg_resp.status_code} {reg_resp.text}")
        return None


async def get_existing_profiles(client: httpx.AsyncClient, bots_url: str, headers: dict, bot_id: str) -> dict:
    """Fetch existing bot profiles and return a dict keyed by agent_name."""
    resp = await client.get(f"{bots_url}/bots/{bot_id}/profiles", headers=headers)
    if resp.status_code != 200:
        return {}
    return {p.get("agent_name"): p for p in resp.json() if p.get("agent_name")}


async def seed_profile(client: httpx.AsyncClient, bots_url: str, headers: dict,
                       bot_id: str, row: dict, existing: dict):
    """Seed a single tavern keeper profile under the shared bot user."""
    agent_name = row["agent_name"]
    display_name = row["display_name"]

    if agent_name in existing:
        # Already exists — just ensure metadata is correct
        p = existing[agent_name]
        bot_profile_id = p.get("bot_profile_id")
        print(f"  Profile '{agent_name}' already exists (bot_profile: {bot_profile_id})")

        patch_resp = await client.patch(
            f"{bots_url}/bots/{bot_id}/profiles/{bot_profile_id}",
            headers=headers,
            json={"behavior_type": "tavern_keeper", "agent_name": agent_name}
        )
        if patch_resp.status_code == 200:
            print(f"    Confirmed behavior_type=tavern_keeper, agent_name={agent_name}")
        else:
            print(f"    ⚠️ PATCH failed: {patch_resp.status_code} {patch_resp.text}")
        return

    # Create new profile
    image_links = [row["image_link"]] if row.get("image_link") else []
    profile_payload = {
        "display_name": display_name,
        "tagline": row.get("tagline", ""),
        "bio": row.get("bio", ""),
        "image_links": image_links,
        "behavior_type": "tavern_keeper",
        "agent_name": agent_name,
        "gender": [],
        "race": [],
        "fandom": [],
        "interests": []
    }

    prof_resp = await client.post(
        f"{bots_url}/bots/{bot_id}/profile",
        headers=headers,
        json=profile_payload
    )
    if prof_resp.status_code != 201:
        print(f"  ❌ Profile creation failed for '{agent_name}': {prof_resp.status_code} {prof_resp.text}")
        return
    resp_data = prof_resp.json()
    print(f"  Profile created: {resp_data.get('profile_id')} (bot_profile: {resp_data.get('bot_profile_id')})")


async def main():
    if len(sys.argv) != 2:
        print("Usage: python seed_tavern_keepers.py <env_name>")
        print("  env_name: dev | test | prod")
        sys.exit(1)

    env = sys.argv[1]
    print(f"🚀 Seeding Tavern Keepers in [{env}] environment")
    urls = await fetch_urls(env)

    if "bots" not in urls:
        print("❌ 'bots' service not registered in router! Register it first.")
        sys.exit(1)

    print("🔐 Authenticating Root Admin...")
    try:
        token = await get_root_token(urls["auth"], urls["users"])
    except Exception as e:
        print(f"❌ Authentication failed: {e}")
        sys.exit(1)
    headers = {"Authorization": f"Bearer {token}"}

    if not os.path.exists(CSV_PATH):
        print(f"❌ CSV not found: {CSV_PATH}")
        sys.exit(1)

    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        rows = list(csv.DictReader(f))

    print(f"📋 Found {len(rows)} tavern keeper persona(s) in CSV")

    # One bot user for all tavern keepers in this environment
    slug = f"{BOT_SLUG_PREFIX}-{env}"
    bots_url = urls["bots"]

    async with httpx.AsyncClient(timeout=30.0) as client:
        print(f"\n👤 Ensuring bot user: {slug}")
        bot_id = await ensure_bot_user(client, bots_url, headers, slug)
        if not bot_id:
            print("❌ Could not create or find bot user. Aborting.")
            sys.exit(1)

        # Fetch existing profiles to skip duplicates
        existing = await get_existing_profiles(client, bots_url, headers, bot_id)
        print(f"  Existing profiles: {list(existing.keys()) or '(none)'}")

        # Seed each persona
        for row in rows:
            try:
                await seed_profile(client, bots_url, headers, bot_id, row, existing)
            except Exception as e:
                print(f"  ❌ Failed to seed {row.get('agent_name')}: {e}")

    print(f"\n🏁 Tavern keeper seeding complete for [{env}]!")


if __name__ == "__main__":
    asyncio.run(main())
