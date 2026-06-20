#!/usr/bin/env python3
"""
migrate_adopted_profile_images.py

Migrates adopted profile images from the characters bucket to the profiles bucket by
triggering the `PUT /profiles/{id}` API endpoint using Root Admin credentials.

The profiles service will automatically fetch the external images, normalize them,
upload them to its own profiles GCS bucket, update Firestore, and publish Pub/Sub
events to keep discovery caches in sync.

Usage:
    .venv/bin/python3 scripts/migrate_adopted_profile_images.py dev
    .venv/bin/python3 scripts/migrate_adopted_profile_images.py dev --dry-run
    .venv/bin/python3 scripts/migrate_adopted_profile_images.py prod
"""

import sys
import os
import subprocess
import argparse
import requests

PROJECT_MAP = {
    "local": "tavern-swiper-dev",
    "dev": "tavern-swiper-dev",
    "test": "tavern-swiper-dev",
    "prod": "tavern-swiper-prod",
}

REGION = "us-central1"
SEEDER_EMAIL = os.getenv("ROOT_EMAIL", "root@tavernswiper.com")
SEEDER_PASSWORD = os.getenv("ROOT_PASSWORD", "Password123!")

_ROUTER_DATA = None

def get_url(service_name, env="local"):
    global _ROUTER_DATA
    env_var = f"{service_name.upper()}_URL"
    if os.getenv(env_var):
        return os.getenv(env_var)

    if env == "local":
        ports = {
            "auth": 8001,
            "profiles": 8002,
        }
        return f"http://127.0.0.1:{ports.get(service_name)}"
    
    if _ROUTER_DATA is None:
        project_id = PROJECT_MAP.get(env, "tavern-swiper-dev")
        try:
            deploy_name = f"router-{env}"
            router_url = subprocess.check_output([
                "gcloud", "run", "services", "describe", deploy_name,
                "--platform", "managed", "--region", REGION, "--project", project_id,
                "--format", "value(status.url)"
            ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
            
            resp = requests.get(f"{router_url}/router/services", timeout=5)
            if resp.status_code == 200:
                _ROUTER_DATA = resp.json().get("services", {})
            else:
                _ROUTER_DATA = {} 
        except Exception:
            try:
                router_url = subprocess.check_output([
                    "gcloud", "run", "services", "describe", "router",
                    "--platform", "managed", "--region", REGION, "--project", project_id,
                    "--format", "value(status.url)"
                ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
                resp = requests.get(f"{router_url}/router/services", timeout=5)
                if resp.status_code == 200:
                    _ROUTER_DATA = resp.json().get("services", {})
                else:
                    _ROUTER_DATA = {}
            except Exception:
                _ROUTER_DATA = {}

    if service_name in _ROUTER_DATA and _ROUTER_DATA[service_name]:
        return _ROUTER_DATA[service_name]

    project_id = PROJECT_MAP.get(env, "tavern-swiper-dev")
    deploy_name = f"{service_name}-{env}" if env != "local" else service_name
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name,
            "--platform", "managed", "--region", REGION, "--project", project_id,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
        return url
    except Exception:
        try:
            url = subprocess.check_output([
                "gcloud", "run", "services", "describe", service_name,
                "--platform", "managed", "--region", REGION, "--project", project_id,
                "--format", "value(status.url)"
            ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
            return url
        except Exception:
            return None

def get_token(auth_url, email, password):
    login_resp = requests.post(f"{auth_url}/auth/login", json={"email": email, "password": password}, timeout=30)
    if login_resp.status_code == 200:
        data = login_resp.json()
        id_token = data.get("id_token")
        v_resp = requests.post(f"{auth_url}/auth/verify", json={"id_token": id_token}, timeout=30)
        if v_resp.status_code == 200:
            return v_resp.json()["token"]
    raise Exception(f"Failed to authenticate as {email}: {login_resp.status_code} {login_resp.text}")

def migrate(env: str, dry_run: bool = False):
    project_id = PROJECT_MAP.get(env, "tavern-swiper-dev")
    
    if env == "prod":
        print("⚠️  WARNING: This command will modify the PRODUCTION environment.")
        print(f"   Project : {project_id}")
        confirmation = input("\nType 'Yes, proceed with Prod' to continue: ")
        if confirmation != "Yes, proceed with Prod":
            print("🚫 Aborted. No changes were made.")
            sys.exit(1)

    mode_label = "DRY-RUN" if dry_run else "LIVE"
    print(f"\n🚀 [{mode_label}] Migrating adopted profile images in environment: '{env}'\n")

    auth_url = get_url("auth", env)
    profiles_url = get_url("profiles", env)
    
    if not auth_url or not profiles_url:
        print("❌ Could not determine service URLs.")
        sys.exit(1)

    print(f"🔑 Authenticating as Root Admin ({SEEDER_EMAIL})...")
    token = get_token(auth_url, SEEDER_EMAIL, SEEDER_PASSWORD)
    headers = {"Authorization": f"Bearer {token}"}

    print(f"📄 Fetching all profiles from profiles service...")
    resp = requests.get(f"{profiles_url}/profiles/all", headers=headers, timeout=30)
    if resp.status_code != 200:
        print(f"❌ Failed to fetch profiles: {resp.status_code} {resp.text}")
        sys.exit(1)

    profiles = resp.json()
    print(f"🔍 Found {len(profiles)} profiles to check.")

    scanned = 0
    migrated = 0
    skipped = 0
    errors = 0

    # Target characters bucket name substring
    char_bucket_indicator = "-characters-media-"

    for p in profiles:
        scanned += 1
        profile_id = p.get("profile_id")
        display_name = p.get("display_name", "(unnamed)")
        image_urls = p.get("image_urls", [])

        # Check if any URL contains the characters bucket indicator
        needs_migration = any(char_bucket_indicator in url for url in image_urls)

        if needs_migration:
            print(f"  ⚡ Profile '{display_name}' ({profile_id}) has images in characters bucket:")
            for url in image_urls:
                if char_bucket_indicator in url:
                    print(f"    - {url}")

            if not dry_run:
                try:
                    # PUT update payload
                    payload = {"image_urls": image_urls}
                    update_resp = requests.put(
                        f"{profiles_url}/profiles/{profile_id}",
                        json=payload,
                        headers=headers,
                        timeout=60
                    )
                    if update_resp.status_code == 200:
                        migrated_profile = update_resp.json()
                        new_urls = migrated_profile.get("image_urls", [])
                        print(f"    ✅ Successfully migrated. New URLs:")
                        for n_url in new_urls:
                            print(f"      - {n_url}")
                        migrated += 1
                    else:
                        print(f"    ❌ Failed to migrate profile: {update_resp.status_code} {update_resp.text}")
                        errors += 1
                except Exception as e:
                    print(f"    ❌ Error: {e}")
                    errors += 1
            else:
                print(f"    [DRY-RUN] Would perform PUT /profiles/{profile_id} to trigger migration.")
                migrated += 1
        else:
            skipped += 1

    print(f"\n{'─' * 50}")
    print(f"📊 Migration Summary ({mode_label})")
    print(f"{'─' * 50}")
    print(f"   Total profiles scanned : {scanned}")
    print(f"   Profiles migrated      : {migrated}")
    print(f"   Profiles skipped       : {skipped}")
    print(f"   Errors encountered     : {errors}")
    print(f"{'─' * 50}")

    if errors > 0:
        print(f"\n🔴 Migration finished with errors.")
        sys.exit(1)
    print("\n🏁 Done.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Migrate adopted profile images to profiles bucket via API updates."
    )
    parser.add_argument(
        "env",
        choices=["dev", "test", "prod"],
        help="Target environment",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview profiles that would be migrated without triggering updates",
    )
    args = parser.parse_args()
    migrate(args.env, dry_run=args.dry_run)
