import os
import uuid
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore
from fastapi import FastAPI, HTTPException
from datetime import datetime, timezone
from models import SwipeCreate, SwipeOut, MatchOut

# ---------------------------------------------------------------------------
# Firebase / Firestore initialisation
# ---------------------------------------------------------------------------
_cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
if _cred_path:
    cred = credentials.Certificate(_cred_path)
    firebase_admin.initialize_app(cred)
else:
    firebase_admin.initialize_app()

db = firestore.Client()

app = FastAPI(title="Trystr — Swipes Service", version="1.0.0")
SWIPES_COLLECTION = "swipes"
MATCHES_COLLECTION = "matches"


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


@app.get("/swipes/health")
async def health():
    return {"service": "swipes", "status": "ok"}


@app.post("/swipes/", response_model=SwipeOut, status_code=201)
async def record_swipe(body: SwipeCreate):
    """Record a swipe and create a Match if both profiles swiped right."""
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
async def list_matches(profile_id: str):
    """List all matches for a given profile (queried from both sides)."""
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


@app.get("/swipes/matches/{match_id}/exists")
async def match_exists(match_id: str):
    """Internal endpoint: check if a match_id is valid. Used by Messages."""
    doc = db.collection(MATCHES_COLLECTION).document(match_id).get()
    return {"exists": doc.exists}


@app.get("/swipes/swiped-by/{profile_id}")
async def swiped_by(profile_id: str):
    """Internal endpoint: return all profile IDs already swiped by this profile. Used by Discovery."""
    docs = (
        db.collection(SWIPES_COLLECTION)
        .where("swiper_profile_id", "==", profile_id)
        .stream()
    )
    ids = [doc.to_dict()["swiped_profile_id"] for doc in docs]
    return {"profile_ids": ids}
