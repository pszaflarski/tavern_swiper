import os
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from dotenv import load_dotenv
import httpx
import logging
import traceback

load_dotenv()
import uuid
from datetime import datetime, timezone
from models import FeedResponse, DiscoveryProfile, SwipeCreate, SwipeOut, MatchOut
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
MATCHES_COLLECTION = "matches"

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Tavern Swiper — Discovery Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("discovery")

@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    """Ensure crashes return a JSON response with CORS headers."""
    error_msg = f"Unhandled Exception: {str(exc)}"
    logger.error(f"{error_msg}\n{traceback.format_exc()}")
    return JSONResponse(
        status_code=500,
        content={"detail": error_msg, "type": "unhandled_exception"},
        headers={"Access-Control-Allow-Origin": "*"}
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle Pydantic validation errors explicitly with CORS headers."""
    logger.warning(f"Validation Error: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": exc.body},
        headers={"Access-Control-Allow-Origin": "*"}
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
            if p_resp.status_code != 200:
                 raise HTTPException(status_code=502, detail="Required dependency returned an error")
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
            if p_resp.status_code != 200:
                 raise HTTPException(status_code=502, detail="Required dependency returned an error")
            p_data = p_resp.json()
            if p_data.get("user_id") != uid:
                 raise HTTPException(status_code=403, detail="Not authorized for this profile")
        except httpx.HTTPError:
             raise HTTPException(status_code=502, detail="Required dependency unavailable")

    if body.swiper_profile_id == body.swiped_profile_id:
        raise HTTPException(status_code=400, detail="Cannot swipe on your own profile.")

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

    # Check for mutual right swipe (Match Detection)
    id = None
    if body.direction == "right":
        reciprocal_docs = (
            db.collection(SWIPES_COLLECTION)
            .where("swiper_profile_id", "==", body.swiped_profile_id)
            .where("swiped_profile_id", "==", body.swiper_profile_id)
            .where("direction", "==", "right")
            .limit(1)
            .stream()
        )
        
        # If a reciprocal right swipe exists, create a match
        has_reciprocal = False
        for _ in reciprocal_docs:
            has_reciprocal = True
            break
            
        if has_reciprocal:
            sorted_ids = sorted([body.swiper_profile_id, body.swiped_profile_id])
            id = f"match_{sorted_ids[0]}_{sorted_ids[1]}"
            match_data = {
                "id": id,
                "profiles": sorted_ids,
                "created_at": now,
            }
            db.collection(MATCHES_COLLECTION).document(id).set(match_data)

    return SwipeOut(
        swipe_id=swipe_id,
        swiper_profile_id=body.swiper_profile_id,
        swiped_profile_id=body.swiped_profile_id,
        direction=body.direction,
        created_at=now_str,
        id=id
    )


@app.get("/discovery/matches/{id}", response_model=MatchOut)
async def get_match(id: str, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Fetch match metadata."""
    doc = db.collection(MATCHES_COLLECTION).document(id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Match not found")
    
    data = doc.to_dict()
    return MatchOut(
        id=data["id"],
        profiles=data["profiles"],
        created_at=data["created_at"].isoformat() if isinstance(data["created_at"], datetime) else data["created_at"]
    )


@app.get("/discovery/matches/profile/{profile_id}", response_model=list[MatchOut])
async def list_matches_for_profile(profile_id: str, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Fetch all matches for a given profile."""
    uid, _, _ = auth_data
    # FIXME: In production, we should verify the user owns the profile_id. 
    # For now, it's open to all logged-in users to allow for discovery.
    docs = (
        db.collection(MATCHES_COLLECTION)
        .where("profiles", "array_contains", profile_id)
        .stream()
    )
    result = []
    for doc in docs:
        data = doc.to_dict()
        result.append(MatchOut(
            id=data["id"],
            profiles=data["profiles"],
            created_at=data["created_at"].isoformat() if isinstance(data["created_at"], datetime) else data["created_at"]
        ))
    return result
