import os
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore
from fastapi import FastAPI, HTTPException, Depends
from dotenv import load_dotenv
import httpx

load_dotenv()
import uuid
from datetime import datetime, timezone
from models import FeedResponse, DiscoveryProfile, SwipeCreate, SwipeOut
from auth_utils import get_current_user

# ---------------------------------------------------------------------------
# Firebase / Firestore initialisation
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Firebase / Firestore initialisation
# ---------------------------------------------------------------------------
firebase_admin.initialize_app()
db = firestore.Client(database=os.environ["FIRESTORE_DATABASE_ID"])
PROFILES_SERVICE_URL = os.getenv("PROFILES_SERVICE_URL", "http://profiles:8002")
FEED_LIMIT = int(os.getenv("FEED_LIMIT", "20"))
SWIPES_COLLECTION = "swipes"

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
async def get_feed(profile_id: str, limit: int = 10, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Fetch a deck of candidate profiles to swipe on.
    
    Strategy:
    0. Verify profile_id belongs to the authenticated UID.
    1. Query the local 'swipes' collection for profile_ids this user has already swiped.
    2. Ask the Profiles service for candidate profiles.
    3. Exclude already-swiped profiles and the requesting profile itself.
    4. Return up to 'limit' candidates.
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
        except httpx.HTTPError:
             raise HTTPException(status_code=502, detail="Required dependency unavailable")

        # 1. Get already-swiped IDs from local Firestore
        try:
            swiped_docs = (
                db.collection(SWIPES_COLLECTION)
                .where("swiper_profile_id", "==", profile_id)
                .stream()
            )
            already_swiped = {doc.to_dict()["swiped_profile_id"] for doc in swiped_docs}
        except Exception as e:
            print(f"[ERROR] Failed to fetch swipe history: {e}")
            already_swiped = set()

        # 2. All profiles (via discovery endpoint)
        try:
            profiles_resp = await client.get(f"{PROFILES_SERVICE_URL}/profiles/discovery?limit={limit + 10}", headers=headers)
            profiles_resp.raise_for_status()
            all_profiles = profiles_resp.json()
        except httpx.HTTPError:
            raise HTTPException(
                status_code=502, detail="Required dependency unavailable"
            )

    # 3. Filter
    candidates = [
        DiscoveryProfile(**p)
        for p in all_profiles
        if p["profile_id"] != profile_id and p["profile_id"] not in already_swiped
    ][:limit]

    return FeedResponse(profiles=candidates)


@app.post("/discovery/swipe/", response_model=SwipeOut, status_code=201)
async def record_swipe(body: SwipeCreate, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Record a swipe locally in the Discovery service."""
    uid, _, token = auth_data
    headers = {"Authorization": f"Bearer {token}"}
    
    # 0. Verify ownership of the swiper profile
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            p_resp = await client.get(f"{PROFILES_SERVICE_URL}/profiles/{body.swiper_profile_id}", headers=headers)
            if p_resp.status_code == 404:
                 raise HTTPException(status_code=404, detail="Swiper profile not found")
            if p_resp.json().get("user_id") != uid:
                 raise HTTPException(status_code=403, detail="Not authorized for this profile")
        except httpx.HTTPError:
             raise HTTPException(status_code=502, detail="Required dependency unavailable")

    swipe_id = str(uuid.uuid4())
    now = datetime.now(tz=timezone.utc)
    now_str = now.isoformat()
    
    swipe_data = {
        "swiper_profile_id": body.swiper_profile_id,
        "swiped_profile_id": body.swiped_profile_id,
        "direction": body.direction,
        "created_at": now,
        "modified_at": now,
        "is_deleted": False
    }
    db.collection(SWIPES_COLLECTION).document(swipe_id).set(swipe_data)

    return SwipeOut(
        swipe_id=swipe_id,
        swiper_profile_id=body.swiper_profile_id,
        swiped_profile_id=body.swiped_profile_id,
        direction=body.direction,
        created_at=now_str,
    )
