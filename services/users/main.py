import os
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore
from fastapi import FastAPI, HTTPException, Depends
from datetime import datetime, timezone
from models import UserCreate, UserUpdate, UserOut
from auth_utils import get_current_user

# ---------------------------------------------------------------------------
# Firebase / Firestore initialisation
# ---------------------------------------------------------------------------
_cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
if _cred_path:
    cred = credentials.Certificate(_cred_path)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
else:
    if not firebase_admin._apps:
        firebase_admin.initialize_app()

db = firestore.Client()
COLLECTION = "users"

app = FastAPI(title="Trystr — Users Service", version="1.0.0")

def _now() -> datetime:
    return datetime.now(tz=timezone.utc)

@app.get("/users/health")
async def health():
    return {"service": "users", "status": "ok"}

@app.post("/users/", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, uid: str = Depends(get_current_user)):
    """
    Register a user. The UID is verified via the auth service header.
    """
    ref = db.collection(COLLECTION).document(uid)
    if ref.get().exists:
        # Already exists, just return it (idempotent)
        doc = ref.get().to_dict()
        return UserOut(uid=uid, created_at=doc["created_at"], **doc)

    data = body.model_dump()
    data["created_at"] = _now()
    ref.set(data)
    
    return UserOut(uid=uid, **data)

@app.get("/users/me", response_model=UserOut)
async def get_me(uid: str = Depends(get_current_user)):
    """Fetch current user's account info."""
    doc = db.collection(COLLECTION).document(uid).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    data = doc.to_dict()
    return UserOut(uid=uid, **data)

@app.put("/users/me", response_model=UserOut)
async def update_me(body: UserUpdate, uid: str = Depends(get_current_user)):
    """Update user metadata."""
    ref = db.collection(COLLECTION).document(uid)
    if not ref.get().exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    ref.update(updates)
    
    doc = ref.get().to_dict()
    return UserOut(uid=uid, **doc)
