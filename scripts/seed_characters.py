"""
seed_characters.py — Seed the full character catalog: tag hierarchy + characters + artwork.

Usage:
    .venv/bin/python3 scripts/seed_characters.py [dev|test]

This script is idempotent:
  - Tags: the characters_go endpoint returns 200 with the existing tag if a match exists.
  - Characters: looked up by display_name; skipped if already present.
  - Images: only uploaded if the character has no images yet.

Steps:
  1. Seed the tag hierarchy (fandoms -> gender/race/class children)
  2. Parse sample_characters/characters.csv
  3. For each row: resolve tags, create the character, upload the image
"""

import csv
import os
import sys
import subprocess
import requests

# --- Configuration ---
PROJECT_MAP = {
    "local": "tavern-swiper-dev",
    "dev": "tavern-swiper-dev",
    "test": "tavern-swiper-dev",
    "prod": "tavern-swiper-prod",
}

REGION = "us-central1"
SEEDER_EMAIL = os.getenv("ROOT_EMAIL", "root@tavernswiper.com")
SEEDER_PASSWORD = os.getenv("ROOT_PASSWORD", "Password123!")
SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "sample_characters")
CSV_PATH = os.path.join(SAMPLE_DIR, "characters.csv")

_ROUTER_DATA = None


def get_project_id(env):
    return PROJECT_MAP.get(env, "tavern-swiper-dev")


def get_url(service_name, env="local"):
    global _ROUTER_DATA

    env_var = f"{service_name.upper()}_URL"
    if os.getenv(env_var):
        return os.getenv(env_var)

    if env == "local":
        ports = {"auth": 8001, "characters": 8012}
        return f"http://127.0.0.1:{ports.get(service_name)}"

    if _ROUTER_DATA is None:
        project_id = get_project_id(env)
        try:
            deploy_name = f"router-{env}"
            router_url = subprocess.check_output([
                "gcloud", "run", "services", "describe", deploy_name,
                "--platform", "managed", "--region", REGION, "--project", project_id,
                "--format", "value(status.url)"
            ], stderr=subprocess.DEVNULL).decode("utf-8").strip()

            print(f"📡 Querying Router at {router_url}...")
            resp = requests.get(f"{router_url}/router/services", timeout=5)
            if resp.status_code == 200:
                _ROUTER_DATA = resp.json().get("services", {})
                print("✅ Router data cached.")
            else:
                _ROUTER_DATA = {}
        except Exception:
            _ROUTER_DATA = {}

    if service_name in _ROUTER_DATA and _ROUTER_DATA[service_name]:
        return _ROUTER_DATA[service_name]

    project_id = get_project_id(env)
    deploy_name = f"{service_name}-{env}" if env in ("dev", "test", "prod") else service_name
    try:
        url = subprocess.check_output([
            "gcloud", "run", "services", "describe", deploy_name,
            "--platform", "managed", "--region", REGION, "--project", project_id,
            "--format", "value(status.url)"
        ], stderr=subprocess.DEVNULL).decode("utf-8").strip()
        return url
    except Exception:
        return None


AUTH_URL = None
CHARACTERS_URL = None


def get_token(email, password):
    """Register or Login a user to get their Tavern JWT."""
    print(f"  Attempting login for {email}...")
    login_resp = requests.post(f"{AUTH_URL}/auth/login", json={"email": email, "password": password}, timeout=30)
    if login_resp.status_code == 200:
        data = login_resp.json()
        id_token = data.get("id_token")
        v_resp = requests.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token}, timeout=30)
        if v_resp.status_code == 200:
            return v_resp.json()["token"]
        else:
            print(f"  ⚠️ Tavern Verification Failed: {v_resp.status_code} - {v_resp.text}")

    print(f"  [First-time setup] Registering user: {email}...")
    reg_resp = requests.post(f"{AUTH_URL}/auth/register", json={"email": email, "password": password}, timeout=30)
    if reg_resp.status_code == 200:
        data = reg_resp.json()
        id_token = data.get("id_token")
        v_resp = requests.post(f"{AUTH_URL}/auth/verify", json={"id_token": id_token}, timeout=30)
        if v_resp.status_code == 200:
            return v_resp.json()["token"]

    raise Exception(f"Failed to authenticate {email}")


# ──────────────────────────────────────────────────────────────────────────────
#  STEP 1: Tag Hierarchy
# ──────────────────────────────────────────────────────────────────────────────

# Cache of (category, name) -> tag dict
_TAG_CACHE = {}


def create_tag(headers, category, name, parent_id=None, display_order=0):
    """Create a tag via the characters API. Returns the tag dict."""
    cache_key = (category, name)
    if cache_key in _TAG_CACHE:
        return _TAG_CACHE[cache_key]

    payload = {
        "category": category,
        "name": name,
        "display_order": display_order,
    }
    if parent_id:
        payload["parent_id"] = parent_id

    resp = requests.post(
        f"{CHARACTERS_URL}/characters/tags/",
        json=payload,
        headers=headers,
        timeout=30,
    )
    if resp.status_code in [200, 201]:
        tag = resp.json()
        status = "✅ created" if resp.status_code == 201 else "⏩ exists"
        indent = "  " if parent_id else ""
        print(f"  {indent}{status}: {category}/{name} (id={tag['id']})")
        _TAG_CACHE[cache_key] = tag
        return tag
    else:
        print(f"  ❌ Failed to create {category}/{name}: {resp.status_code} {resp.text}")
        return None


def seed_dnd_tree(headers):
    """Seed the D&D tag hierarchy."""
    print("\n🎲 Seeding D&D tag tree...")

    dnd = create_tag(headers, "fandom", "D&D", display_order=0)
    if not dnd:
        print("❌ Cannot proceed without root fandom tag.")
        return None

    dnd_id = dnd["id"]

    print("\n  👤 Gender tags:")
    create_tag(headers, "gender", "Male", parent_id=dnd_id, display_order=0)
    create_tag(headers, "gender", "Female", parent_id=dnd_id, display_order=1)
    create_tag(headers, "gender", "Non-Binary", parent_id=dnd_id, display_order=2)

    print("\n  🧝 Race tags:")
    create_tag(headers, "race", "Human", parent_id=dnd_id, display_order=0)
    create_tag(headers, "race", "Elf", parent_id=dnd_id, display_order=1)
    create_tag(headers, "race", "Orc", parent_id=dnd_id, display_order=2)
    create_tag(headers, "race", "Undead", parent_id=dnd_id, display_order=3)
    create_tag(headers, "race", "Dwarf", parent_id=dnd_id, display_order=4)
    create_tag(headers, "race", "Halfling", parent_id=dnd_id, display_order=5)
    create_tag(headers, "race", "Tiefling", parent_id=dnd_id, display_order=6)

    print("\n  ⚔️ Class tags:")
    create_tag(headers, "class", "Fighter", parent_id=dnd_id, display_order=0)
    create_tag(headers, "class", "Paladin", parent_id=dnd_id, display_order=1)
    create_tag(headers, "class", "Wizard", parent_id=dnd_id, display_order=2)
    create_tag(headers, "class", "Rogue", parent_id=dnd_id, display_order=3)
    create_tag(headers, "class", "Druid", parent_id=dnd_id, display_order=4)
    create_tag(headers, "class", "Ranger", parent_id=dnd_id, display_order=5)
    create_tag(headers, "class", "Cleric", parent_id=dnd_id, display_order=6)
    create_tag(headers, "class", "Bard", parent_id=dnd_id, display_order=7)
    create_tag(headers, "class", "Warlock", parent_id=dnd_id, display_order=8)

    print(f"\n✅ D&D tree seeded under root tag {dnd_id}")
    return dnd_id


# ──────────────────────────────────────────────────────────────────────────────
#  STEP 2: Resolve Tags
# ──────────────────────────────────────────────────────────────────────────────

def resolve_tag(headers, category, name):
    """Look up a tag from cache or API. Returns CharTag dict {id, category, name, slug}."""
    cache_key = (category, name)
    if cache_key in _TAG_CACHE:
        tag = _TAG_CACHE[cache_key]
        return {"id": tag["id"], "category": tag["category"], "name": tag["name"], "slug": tag["slug"]}

    # Fallback: query by category
    resp = requests.get(
        f"{CHARACTERS_URL}/characters/tags/by-category/{category}",
        headers=headers,
        timeout=30,
    )
    if resp.status_code == 200:
        for tag in resp.json():
            _TAG_CACHE[(tag["category"], tag["name"])] = tag
            if tag["name"] == name:
                return {"id": tag["id"], "category": tag["category"], "name": tag["name"], "slug": tag["slug"]}

    print(f"  ⚠️ Could not resolve tag {category}/{name}")
    return None


# ──────────────────────────────────────────────────────────────────────────────
#  STEP 3: Create Characters + Upload Images
# ──────────────────────────────────────────────────────────────────────────────

def get_existing_characters(headers):
    """Fetch all existing characters and return a set of display_names."""
    resp = requests.get(f"{CHARACTERS_URL}/characters/", headers=headers, timeout=30)
    if resp.status_code == 200:
        return {c["display_name"]: c for c in resp.json()}
    return {}


def create_character(headers, row):
    """Create a single character from a CSV row. Returns the character dict or None."""
    display_name = row["name"]

    # Resolve tags
    fandom_tag = resolve_tag(headers, "fandom", row["fandom"])
    race_tag = resolve_tag(headers, "race", row["race"])
    gender_tag = resolve_tag(headers, "gender", row["gender"])

    payload = {
        "display_name": display_name,
        "tagline": row["tagline"],
        "bio": row["bio"],
        "fandom": [fandom_tag] if fandom_tag else [],
        "race": [race_tag] if race_tag else [],
        "gender": [gender_tag] if gender_tag else [],
        "image_ids": [],
    }

    resp = requests.post(
        f"{CHARACTERS_URL}/characters/",
        json=payload,
        headers=headers,
        timeout=30,
    )
    if resp.status_code in [200, 201]:
        char = resp.json()
        print(f"  ✅ Created: {display_name} (id={char['character_id']})")
        return char
    else:
        print(f"  ❌ Failed to create {display_name}: {resp.status_code} {resp.text}")
        return None


def upload_character_image(headers, character_id, image_filename):
    """Upload a JPEG from sample_characters/ to the character."""
    image_path = os.path.join(SAMPLE_DIR, image_filename)
    if not os.path.exists(image_path):
        print(f"    ⚠️ Image file not found: {image_path}")
        return False

    with open(image_path, "rb") as f:
        files = {"file": (image_filename, f, "image/jpeg")}
        data = {
            "character_id": character_id,
            "source_type": "ai_generated",
            "position": "0",
        }
        resp = requests.post(
            f"{CHARACTERS_URL}/characters/images",
            files=files,
            data=data,
            headers=headers,
            timeout=60,
        )

    if resp.status_code == 201:
        img = resp.json()
        print(f"    🖼️ Uploaded: {image_filename} (image_id={img['image_id']})")
        return True
    else:
        print(f"    ❌ Image upload failed: {resp.status_code} {resp.text}")
        return False


def seed_characters(headers):
    """Parse CSV and create characters with images."""
    print("\n📜 Seeding characters from characters.csv...")

    if not os.path.exists(CSV_PATH):
        print(f"❌ CSV not found at {CSV_PATH}")
        return

    # Get existing characters for idempotency
    existing = get_existing_characters(headers)
    print(f"  Found {len(existing)} existing characters")

    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    created_count = 0
    skipped_count = 0
    image_count = 0

    for row in rows:
        display_name = row["name"]

        if display_name in existing:
            char = existing[display_name]
            # Check if images already exist
            if char.get("images") and len(char["images"]) > 0:
                print(f"  ⏩ Skipped: {display_name} (already exists with images)")
                skipped_count += 1
                continue
            else:
                # Character exists but no images — upload the image
                print(f"  🔄 Exists without images: {display_name}")
                if row.get("image"):
                    upload_character_image(headers, char["character_id"], row["image"])
                    image_count += 1
                skipped_count += 1
                continue

        # Create the character
        char = create_character(headers, row)
        if char:
            created_count += 1
            # Upload the image
            if row.get("image"):
                if upload_character_image(headers, char["character_id"], row["image"]):
                    image_count += 1

    print(f"\n✅ Characters seeded: {created_count} created, {skipped_count} skipped, {image_count} images uploaded")


# ──────────────────────────────────────────────────────────────────────────────
#  STEP 4: Verify
# ──────────────────────────────────────────────────────────────────────────────

def verify(headers):
    """Verify the full seed by querying the API."""
    print("\n🔍 Verification...")

    # Check tag roots
    resp = requests.get(f"{CHARACTERS_URL}/characters/tags/roots", headers=headers, timeout=30)
    if resp.status_code == 200:
        roots = resp.json()
        print(f"  Tag roots: {len(roots)}")
        for root in roots:
            print(f"    📂 {root['name']} ({root['category']}) — {root.get('child_count', 0)} children")

    # Check characters
    resp = requests.get(f"{CHARACTERS_URL}/characters/", headers=headers, timeout=30)
    if resp.status_code == 200:
        chars = resp.json()
        with_images = sum(1 for c in chars if c.get("images") and len(c["images"]) > 0)
        print(f"  Characters: {len(chars)} total, {with_images} with images")

        # Sample a few
        for char in chars[:3]:
            img_count = len(char.get("images") or [])
            fandoms = ", ".join(t["name"] for t in char.get("fandom") or [])
            print(f"    ⚔️ {char['display_name']} | fandom={fandoms} | images={img_count}")
    else:
        print(f"  ❌ Failed to list characters: {resp.status_code}")

    print("✅ Verification complete.")


# ──────────────────────────────────────────────────────────────────────────────
#  Main
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    env = "dev"
    if len(sys.argv) > 1:
        env = sys.argv[1]

    print(f"🚀 Seeding characters in {env} environment...")

    AUTH_URL = get_url("auth", env)
    CHARACTERS_URL = get_url("characters", env)

    if not all([AUTH_URL, CHARACTERS_URL]):
        print("❌ Could not determine all service URLs.")
        sys.exit(1)

    print(f"  Auth URL: {AUTH_URL}")
    print(f"  Characters URL: {CHARACTERS_URL}")

    token = get_token(SEEDER_EMAIL, SEEDER_PASSWORD)
    headers = {"Authorization": f"Bearer {token}"}

    # Step 1: Seed tags
    seed_dnd_tree(headers)

    # Step 2+3: Create characters + upload images
    seed_characters(headers)

    # Step 4: Verify
    verify(headers)

    print("\n🏁 Done!")
