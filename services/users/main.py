import os
from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from fastapi import FastAPI, HTTPException, Depends
from dotenv import load_dotenv
from datetime import datetime, timezone

load_dotenv()
import httpx
from models import UserCreate, UserUpdate, UserOut, UserType
from auth_utils import get_current_user

AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://localhost:8001")

# ---------------------------------------------------------------------------
# Firestore initialisation
# ---------------------------------------------------------------------------
db = firestore.Client(database=os.environ["FIRESTORE_DATABASE_ID"])
COLLECTION = "users"

# ...

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Tavern Swiper — Users Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _now() -> datetime:
    return datetime.now(tz=timezone.utc)

async def get_admin(auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Dependency to ensure the user has admin or root_admin role."""
    uid, role, _ = auth_data
    if role not in [UserType.ADMIN, UserType.ROOT_ADMIN]:
        raise HTTPException(status_code=403, detail="Admin or Root Admin role required")
    return uid

async def get_root_admin(auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Dependency to ensure the user has root_admin role."""
    _, role, _ = auth_data
    if role != UserType.ROOT_ADMIN:
        raise HTTPException(status_code=403, detail="Root Admin authority required")
    return True # Just returning success for the dependency

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
async def list_users(include_deleted: bool = False, _: str = Depends(get_admin)):
    """List all users. Admin only."""
    query = db.collection(COLLECTION)
    docs = query.stream()
    users = []
    for doc in docs:
        data = doc.to_dict()
        # Filter out soft-deleted users unless explicitly requested
        if not include_deleted and data.get("is_deleted") is True:
            continue
        users.append(UserOut(uid=doc.id, **data))
    return users

@app.get("/users/me", response_model=UserOut)
async def get_me(auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Fetch current user's account info."""
    uid, _, _ = auth_data
    doc = db.collection(COLLECTION).document(uid).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    data = doc.to_dict()
    return UserOut(uid=uid, **data)

@app.put("/users/me", response_model=UserOut)
async def update_me(body: UserUpdate, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Update user metadata."""
    uid, _, _ = auth_data
    ref = db.collection(COLLECTION).document(uid)
    if not ref.get().exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    ref.update(updates)
    
    doc = ref.get().to_dict()
    return UserOut(uid=uid, **doc)

@app.delete("/users/", status_code=204)
async def purge_all_users(_: bool = Depends(get_root_admin)):
    """Hard delete all user records from Firestore and Firebase Auth. Root Admin only."""
    # 1. Get all UIDs
    docs = list(db.collection(COLLECTION).stream())
    uids = [doc.id for doc in docs]
    
    # 2. Call Auth service to bulk delete from Firebase Auth
    if uids:
        try:
            async with httpx.AsyncClient() as client:
                await client.request("DELETE", f"{AUTH_SERVICE_URL}/auth/users/", json={"uids": uids})
        except Exception as e:
            print(f"Failed to call auth service for bulk delete: {e}")

    # 3. Clear Firestore
    batch = db.batch()
    count = 0
    for doc in docs:
        batch.delete(doc.reference)
        count += 1
        if count >= 500:
            batch.commit()
            batch = db.batch()
            count = 0
    if count > 0:
        batch.commit()
    return None

@app.delete("/users/{target_uid}", status_code=204)
async def delete_user(target_uid: str, hard: bool = False, _: str = Depends(get_admin)):
    """Delete a user. Admin only. 'hard=True' deletes from Auth too."""
    ref = db.collection(COLLECTION).document(target_uid)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    data = doc.to_dict()
    if data.get("user_type") == UserType.ROOT_ADMIN:
        # Check if this is the last root admin
        query = db.collection(COLLECTION).where(filter=FieldFilter("user_type", "==", UserType.ROOT_ADMIN)).stream()
        roots = [r for r in query if not r.to_dict().get("is_deleted")]
        if len(roots) <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last active root admin.")

    if hard:
        # 1. Delete from Auth service
        try:
            async with httpx.AsyncClient() as client:
                await client.delete(f"{AUTH_SERVICE_URL}/auth/users/{target_uid}")
        except Exception as e:
            print(f"Failed to call auth service for hard delete: {e}")
        # 2. Hard delete from Firestore
        ref.delete()
    else:
        # Soft delete
        ref.update({"is_deleted": True})
    
    return None

@app.patch("/users/{target_uid}/restore", response_model=UserOut)
async def restore_user(target_uid: str, _: str = Depends(get_admin)):
    """Restore a soft-deleted user record."""
    ref = db.collection(COLLECTION).document(target_uid)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="User not found")
    
    ref.update({"is_deleted": False})
    updated_doc = ref.get().to_dict()
    return UserOut(uid=target_uid, **updated_doc)

@app.post("/users/", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """
    Consolidated user creation endpoint.
    
    Scenarios:
    1. Root Admin Init: user_type == root_admin, singleton check, used by caller.
    2. Administrative Creation: body.uid is set, caller must be admin.
    3. Self Registration: body.uid is None, user creates their own record.
    """
    caller_uid, caller_role, _ = auth_data
    # 1. Handle Root Admin Initialization (Singleton)
    if body.user_type == UserType.ROOT_ADMIN:
        query = db.collection(COLLECTION).where(filter=FieldFilter("user_type", "==", UserType.ROOT_ADMIN)).limit(1).stream()
        if any(query):
            raise HTTPException(status_code=400, detail="A root admin already exists.")
        target_uid = caller_uid

    # 2. Handle Administrative Creation
    elif body.uid:
        # Caller must be admin to create a record for someone else
        if caller_role not in [UserType.ADMIN, UserType.ROOT_ADMIN]:
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

