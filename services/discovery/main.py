import os
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore
from fastapi import FastAPI, HTTPException, Depends
from dotenv import load_dotenv
import httpx

load_dotenv()
from models import FeedResponse, DiscoveryProfile
from auth_utils import get_current_user

# ---------------------------------------------------------------------------
# Firebase / Firestore initialisation
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Firebase / Firestore initialisation
# ---------------------------------------------------------------------------
firebase_admin.initialize_app()
db = firestore.Client(database=os.getenv("FIRESTORE_DATABASE_ID", "(default)"))
PROFILES_SERVICE_URL = os.getenv("PROFILES_SERVICE_URL", "http://profiles:8002")
SWIPES_SERVICE_URL = os.getenv("SWIPES_SERVICE_URL", "http://swipes:8004")
FEED_LIMIT = int(os.getenv("FEED_LIMIT", "20"))

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Tavern Swiper — Discovery Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/discovery/health")
async def health():
    return {"service": "discovery", "status": "ok"}


@app.get("/discovery/feed/{profile_id}", response_model=FeedResponse)
async def get_feed(profile_id: str, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Fetch a deck of candidate profiles to swipe on.
    
    Strategy:
    0. Verify profile_id belongs to the authenticated UID.
    1. Ask the Swipes service which profile_ids this user has already swiped.
    2. Ask the Profiles service for all profiles.
    3. Exclude already-swiped profiles and the requesting profile itself.
    4. Return up to FEED_LIMIT candidates.
    """
    uid, _, token = auth_data
    headers = {"Authorization": f"Bearer {token}"}
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        # 0. Verify ownership
        try:
            p_resp = await client.get(f"{PROFILES_SERVICE_URL}/profiles/{profile_id}", headers=headers)
            if p_resp.status_code == 404:
                raise HTTPException(status_code=404, detail="Profile not found")
            p_data = p_resp.json()
            if p_data.get("user_id") != uid:
                raise HTTPException(status_code=403, detail="Not authorized for this profile")
        except httpx.HTTPError as e:
             raise HTTPException(status_code=502, detail=f"Profiles service unavailable: {e}")

        # 1. Already-swiped IDs
        try:
            swipes_resp = await client.get(
                f"{SWIPES_SERVICE_URL}/swipes/swiped-by/{profile_id}",
                headers=headers
            )
            swipes_resp.raise_for_status()
            already_swiped: set[str] = set(swipes_resp.json().get("profile_ids", []))
        except httpx.HTTPError:
            already_swiped = set()

        # 2. All profiles
        try:
            profiles_resp = await client.get(f"{PROFILES_SERVICE_URL}/profiles/all", headers=headers)
            profiles_resp.raise_for_status()
            all_profiles = profiles_resp.json()
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=502, detail=f"Profiles service unavailable: {e}"
            )

    # 3. Filter
    candidates = [
        DiscoveryProfile(**p)
        for p in all_profiles
        if p["profile_id"] != profile_id and p["profile_id"] not in already_swiped
    ][:FEED_LIMIT]

    return FeedResponse(profiles=candidates)
