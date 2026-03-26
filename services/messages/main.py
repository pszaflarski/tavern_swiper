import os
import uuid
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore
from fastapi import FastAPI, HTTPException
from datetime import datetime, timezone
import httpx
from models import MessageCreate, MessageOut

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
SWIPES_SERVICE_URL = os.getenv("SWIPES_SERVICE_URL", "http://swipes:8004")

app = FastAPI(title="Trystr — Messages Service", version="1.0.0")
COLLECTION = "messages"


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


async def _verify_match(match_id: str) -> None:
    """Raise 403 if match_id does not exist in the Swipes service."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.get(
                f"{SWIPES_SERVICE_URL}/swipes/matches/{match_id}/exists"
            )
            resp.raise_for_status()
            if not resp.json().get("exists", False):
                raise HTTPException(
                    status_code=403,
                    detail="No valid match exists between these profiles",
                )
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=502, detail=f"Swipes service unavailable: {e}"
            )


@app.get("/messages/health")
async def health():
    return {"service": "messages", "status": "ok"}


@app.post("/messages/", response_model=MessageOut, status_code=201)
async def send_message(body: MessageCreate):
    """Send a message. Enforces that a valid Match record exists first."""
    await _verify_match(body.match_id)

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
async def get_messages(match_id: str):
    """Fetch message history for a match, ordered by time."""
    await _verify_match(match_id)
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
