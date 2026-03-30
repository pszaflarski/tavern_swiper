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
from models import MessageCreate, MessageOut
from auth_utils import get_current_user

# ---------------------------------------------------------------------------
# Firebase / Firestore initialisation
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Firebase / Firestore initialisation
# ---------------------------------------------------------------------------
firebase_admin.initialize_app()
db = firestore.Client(database=os.environ["FIRESTORE_DATABASE_ID"])
SWIPES_SERVICE_URL = os.getenv("SWIPES_SERVICE_URL", "http://swipes:8004")
PROFILES_SERVICE_URL = os.getenv("PROFILES_SERVICE_URL", "http://profiles:8002")

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Tavern Swiper — Messages Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
COLLECTION = "messages"


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


async def _verify_match_access(match_id: str, uid: str, token: str) -> None:
    """Verify match exists AND the authenticated uid owns one of the profiles in it. Secured with Auth."""
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=5.0) as client:
        # 1. Get match details
        try:
            resp = await client.get(f"{SWIPES_SERVICE_URL}/swipes/matches/{match_id}", headers=headers)
            if resp.status_code != 200:
                raise HTTPException(status_code=403, detail="Not an active match")
            match_data = resp.json()
        except httpx.HTTPError:
            raise HTTPException(status_code=502, detail="Swipes service unavailable")

        # 2. Check if UID owns either profile_id_a or profile_id_b
        p_ids = [match_data["profile_id_a"], match_data["profile_id_b"]]
        owned = False
        for pid in p_ids:
            try:
                p_resp = await client.get(f"{PROFILES_SERVICE_URL}/profiles/{pid}", headers=headers)
                if p_resp.status_code == 200 and p_resp.json().get("user_id") == uid:
                    owned = True
                    break
            except httpx.HTTPError:
                continue
        
        if not owned:
            raise HTTPException(status_code=403, detail="Not authorized for this match")


@app.get("/messages/health")
async def health():
    return {"service": "messages", "status": "ok"}


@app.post("/messages/", response_model=MessageOut, status_code=201)
async def send_message(body: MessageCreate, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Send a message. Enforces match ownership."""
    uid, _, token = auth_data
    await _verify_match_access(body.match_id, uid, token)

    message_id = str(uuid.uuid4())
    now = _now()
    data = {
        "match_id": body.match_id,
        "sender_profile_id": body.sender_profile_id,
        "content": body.content,
        "sent_at": now,
    }
    db.collection(COLLECTION).document(message_id).set(data)
    return MessageOut(message_id=message_id, sent_at=now, **body.model_dump())


@app.get("/messages/{match_id}", response_model=list[MessageOut])
async def get_messages(match_id: str, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Fetch message history for a match, ordered by time."""
    uid, _, token = auth_data
    await _verify_match_access(match_id, uid, token)
    docs = (
        db.collection(COLLECTION)
        .where("match_id", "==", match_id)
        .order_by("sent_at")
        .stream()
    )
    result = []
    for doc in docs:
        d = doc.to_dict()
        result.append(
            MessageOut(
                message_id=doc.id,
                match_id=d["match_id"],
                sender_profile_id=d["sender_profile_id"],
                content=d["content"],
                sent_at=d["sent_at"],
            )
        )
    return result


@app.delete("/messages/", status_code=204)
async def delete_all_messages(auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Delete all messages. Admin/Root Admin only."""
    _, role, _ = auth_data
    if role not in ["admin", "root_admin"]:
        raise HTTPException(status_code=403, detail="Admin or Root Admin authorization required")
    
    # Batch delete
    batch_size = 500
    while True:
        docs = db.collection(COLLECTION).limit(batch_size).stream()
        deleted = 0
        batch = db.batch()
        for doc in docs:
            batch.delete(doc.reference)
            deleted += 1
        
        if deleted == 0:
            break
        
        batch.commit()
