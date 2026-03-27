import os
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from fastapi import FastAPI, HTTPException, Depends
from dotenv import load_dotenv
from datetime import datetime, timezone

load_dotenv()
from models import UserCreate, UserUpdate, UserOut, UserType
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

db = firestore.Client(database=os.getenv("FIRESTORE_DATABASE_ID", "(default)"))
COLLECTION = "users"

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Trystr — Users Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _now() -> datetime:
    return datetime.now(tz=timezone.utc)

async def get_admin(uid: str = Depends(get_current_user)):
    """Dependency to ensure the user has admin or root_admin role."""
    doc = db.collection(COLLECTION).document(uid).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User record not found in database")
    data = doc.to_dict()
    if data.get("user_type") not in [UserType.ADMIN, UserType.ROOT_ADMIN]:
        raise HTTPException(status_code=403, detail="Admin or Root Admin role required")
    return uid

async def get_root_admin(uid: str = Depends(get_current_user)):
    """Dependency to ensure the user has root_admin role."""
    doc = db.collection(COLLECTION).document(uid).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User record not found in database")
    data = doc.to_dict()
    if data.get("user_type") != UserType.ROOT_ADMIN:
        raise HTTPException(status_code=403, detail="Root Admin authority required")
    return uid

@app.get("/users/health")
async def health():
    return {"service": "users", "status": "ok"}

@app.get("/users/root-admin-exists")
async def check_root_admin():
    """Check if a root admin already exists in the system."""
    query = db.collection(COLLECTION).where(filter=FieldFilter("user_type", "==", UserType.ROOT_ADMIN)).limit(1).stream()
    exists = any(query)
    return {"exists": exists}

@app.get("/users/", response_model=list[UserOut])
async def list_users(_: str = Depends(get_admin)):
    """List all users. Admin only."""
    docs = db.collection(COLLECTION).stream()
    return [UserOut(uid=doc.id, **doc.to_dict()) for doc in docs]

@app.delete("/users/", status_code=204)
async def purge_all_users(_: str = Depends(get_root_admin)):
    """Hard delete all user records from Firestore. Root Admin only."""
    docs = db.collection(COLLECTION).stream()
    batch = db.batch()
    count = 0
    for doc in docs:
        batch.delete(doc.reference)
        count += 1
        if count >= 500: # Firestore batch limit
            batch.commit()
            batch = db.batch()
            count = 0
    if count > 0:
        batch.commit()
    return None

@app.delete("/users/{target_uid}", status_code=204)
async def delete_user(target_uid: str, current_uid: str = Depends(get_admin)):
    """Delete a user. Admin only."""
    ref = db.collection(COLLECTION).document(target_uid)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    data = doc.to_dict()
    if data.get("user_type") == UserType.ROOT_ADMIN:
        # Check if this is the last root admin
        query = db.collection(COLLECTION).where(filter=FieldFilter("user_type", "==", UserType.ROOT_ADMIN)).stream()
        roots = list(query)
        if len(roots) <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last root admin.")

    ref.delete()
    return None

@app.post("/users/", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, caller_uid: str = Depends(get_current_user)):
    """
    Consolidated user creation endpoint.
    
    Scenarios:
    1. Root Admin Init: user_type == root_admin, singleton check, used by caller.
    2. Administrative Creation: body.uid is set, caller must be admin.
    3. Self Registration: body.uid is None, user creates their own record.
    """
    # 1. Handle Root Admin Initialization (Singleton)
    if body.user_type == UserType.ROOT_ADMIN:
        query = db.collection(COLLECTION).where(filter=FieldFilter("user_type", "==", UserType.ROOT_ADMIN)).limit(1).stream()
        if any(query):
            raise HTTPException(status_code=400, detail="A root admin already exists.")
        target_uid = caller_uid

    # 2. Handle Administrative Creation
    elif body.uid:
        # Caller must be admin to create a record for someone else
        doc = db.collection(COLLECTION).document(caller_uid).get()
        if not doc.exists:
             raise HTTPException(status_code=403, detail="Admin authorization required (caller not found)")
        data = doc.to_dict()
        if data.get("user_type") not in [UserType.ADMIN, UserType.ROOT_ADMIN]:
            raise HTTPException(status_code=403, detail="Admin authorization required")
        target_uid = body.uid

    # 3. Handle Self-Registration
    else:
        # Normal users can only register as 'user' type
        if body.user_type != UserType.USER:
            raise HTTPException(status_code=403, detail="Can only self-register as 'user' type")
        target_uid = caller_uid

    # Final Check: Record existence
    ref = db.collection(COLLECTION).document(target_uid)
    existing_doc = ref.get()
    if existing_doc.exists:
        if not body.uid: # Self-registration (Make it idempotent)
            return UserOut(uid=target_uid, **existing_doc.to_dict())
        raise HTTPException(status_code=400, detail="User record already exists")

    # Create Record
    data = body.model_dump(exclude={"uid"})
    data["created_at"] = _now()
    ref.set(data)
    
    return UserOut(uid=target_uid, **data)

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
