import os
import uuid
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore
from fastapi import FastAPI, HTTPException, Depends
from dotenv import load_dotenv
from datetime import datetime, timezone

load_dotenv()
import httpx
from models import SwipeCreate, SwipeOut, MatchOut
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

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Tavern Swiper — Swipes Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
SWIPES_COLLECTION = "swipes"
MATCHES_COLLECTION = "matches"


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


@app.get("/swipes/health")
async def health():
    return {"service": "swipes", "status": "ok"}


@app.post("/swipes/", response_model=SwipeOut, status_code=201)
async def record_swipe(body: SwipeCreate, auth_data: tuple[str, str] = Depends(get_current_user)):
    """Record a swipe and create a Match if both profiles swiped right."""
    uid, token = auth_data
    headers = {"Authorization": f"Bearer {token}"}
    
    # Verify ownership of the swiper profile
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            p_resp = await client.get(f"{PROFILES_SERVICE_URL}/profiles/{body.swiper_profile_id}", headers=headers)
            if p_resp.status_code == 404:
                 raise HTTPException(status_code=404, detail="Swiper profile not found")
            if p_resp.json().get("user_id") != uid:
                 raise HTTPException(status_code=403, detail="Not authorized for this profile")
        except httpx.HTTPError as e:
             raise HTTPException(status_code=502, detail=f"Profiles service unavailable: {e}")

    swipe_id = str(uuid.uuid4())
    now = _now()
    swipe_data = {
        "swiper_profile_id": body.swiper_profile_id,
        "swiped_profile_id": body.swiped_profile_id,
        "direction": body.direction,
        "created_at": now,
    }
    db.collection(SWIPES_COLLECTION).document(swipe_id).set(swipe_data)

    # Check for mutual right swipe → create Match
    if body.direction == "right":
        reverse = (
            db.collection(SWIPES_COLLECTION)
            .where("swiper_profile_id", "==", body.swiped_profile_id)
            .where("swiped_profile_id", "==", body.swiper_profile_id)
            .where("direction", "==", "right")
            .limit(1)
            .stream()
        )
        if any(True for _ in reverse):
            match_id = str(uuid.uuid4())
            db.collection(MATCHES_COLLECTION).document(match_id).set(
                {
                    "profile_id_a": body.swiper_profile_id,
                    "profile_id_b": body.swiped_profile_id,
                    "created_at": now,
                }
            )

    return SwipeOut(
        swipe_id=swipe_id,
        swiper_profile_id=body.swiper_profile_id,
        swiped_profile_id=body.swiped_profile_id,
        direction=body.direction,
        created_at=now,
    )


@app.get("/swipes/matches/{profile_id}", response_model=list[MatchOut])
async def list_matches(profile_id: str, auth_data: tuple[str, str] = Depends(get_current_user)):
    """List all matches for a given profile (queried from both sides)."""
    uid, token = auth_data
    headers = {"Authorization": f"Bearer {token}"}
    
    # Verify ownership
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            p_resp = await client.get(f"{PROFILES_SERVICE_URL}/profiles/{profile_id}", headers=headers)
            if p_resp.status_code == 404:
                 raise HTTPException(status_code=404, detail="Profile not found")
            if p_resp.json().get("user_id") != uid:
                 raise HTTPException(status_code=403, detail="Not authorized for this profile")
        except httpx.HTTPError as e:
             raise HTTPException(status_code=502, detail=f"Profiles service unavailable: {e}")

    results = []
    for field in ("profile_id_a", "profile_id_b"):
        docs = (
            db.collection(MATCHES_COLLECTION)
            .where(field, "==", profile_id)
            .stream()
        )
        for doc in docs:
            d = doc.to_dict()
            results.append(
                MatchOut(
                    match_id=doc.id,
                    profile_id_a=d["profile_id_a"],
                    profile_id_b=d["profile_id_b"],
                    created_at=d["created_at"],
                )
            )
    return results


@app.get("/swipes/matches/{match_id}", response_model=MatchOut)
async def get_match_details(match_id: str, auth_data: tuple[str, str] = Depends(get_current_user)):
    """Internal endpoint: get details of a specific match. Now secured."""
    _, _ = auth_data
    doc = db.collection(MATCHES_COLLECTION).document(match_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Match not found")
    d = doc.to_dict()
    return MatchOut(
        match_id=doc.id,
        profile_id_a=d["profile_id_a"],
        profile_id_b=d["profile_id_b"],
        created_at=d["created_at"]
    )

@app.get("/swipes/matches/{match_id}/exists")


@app.get("/swipes/swiped-by/{profile_id}")
async def swiped_by(profile_id: str, auth_data: tuple[str, str] = Depends(get_current_user)):
    """Internal endpoint: return all profile IDs already swiped by this profile. Now secured."""
    _, _ = auth_data
    docs = (
        db.collection(SWIPES_COLLECTION)
        .where("swiper_profile_id", "==", profile_id)
        .stream()
    )
    ids = [doc.to_dict()["swiped_profile_id"] for doc in docs]
    return {"profile_ids": ids}
