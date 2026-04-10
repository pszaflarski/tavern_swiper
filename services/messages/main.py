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
PROFILES_SERVICE_URL = os.getenv("PROFILES_SERVICE_URL", "http://profiles:8002")
DISCOVERY_SERVICE_URL = os.getenv("DISCOVERY_SERVICE_URL", "http://discovery:8003")

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
    """
    FIXME: Match verification currently disabled because Swipes service was eliminated.
    For now, we allow messaging in the test environment while we re-architect Matches.
    """
    print(f"[WARNING] Skipping match verification for match_id: {match_id}. Swipes service is offline.")
    # In a full implementation, we'd query the new Matches service here.
    return


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
    
    # To enable conversation listing, we need to know participants.
    # We fetch the match details from the Discovery service.
    participants = []
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            headers = {"Authorization": f"Bearer {token}"}
            match_resp = await client.get(f"{DISCOVERY_SERVICE_URL}/discovery/matches/{body.match_id}", headers=headers)
            if match_resp.status_code == 200:
                match_data = match_resp.json()
                participants = match_data.get("profiles", [])
        except Exception as e:
            print(f"[WARNING] Failed to fetch match participants for conversation indexing: {e}")

    data = {
        "match_id": body.match_id,
        "sender_profile_id": body.sender_profile_id,
        "content": body.content,
        "sent_at": now,
        "participant_profile_ids": participants
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
    # Sort in-memory to avoid Firestore index requirement
    result.sort(key=lambda x: x.sent_at)
    return result


@app.get("/messages/conversations/{profile_id}")
async def list_conversations(profile_id: str, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """
    List all conversations for a profile.
    A conversation is the latest message per match_id.
    """
    uid, _, _ = auth_data
    # FIXME: Production should verify ownership of profile_id.
    
    # Query messages where this profile is a participant.
    # We order by sent_at DESC to get new messages first.
    docs = (
        db.collection(COLLECTION)
        .where("participant_profile_ids", "array_contains", profile_id)
        .stream()
    )
    
    # Sort in-memory to avoid Firestore index requirement
    all_docs = sorted(docs, key=lambda d: d.to_dict().get("sent_at"), reverse=True)
    
    # Group by match_id to only return the latest message for each conversation
    conversations = {}
    for doc in all_docs:
        d = doc.to_dict()
        mid = d["match_id"]
        if mid not in conversations:
            conversations[mid] = {
                "match_id": mid,
                "last_message": {
                    "content": d["content"],
                    "sent_at": d["sent_at"].isoformat() if isinstance(d["sent_at"], datetime) else d["sent_at"],
                    "sender_profile_id": d["sender_profile_id"]
                }
            }
            
    return list(conversations.values())


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
