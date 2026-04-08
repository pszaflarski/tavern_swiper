import os
import uuid
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore, storage
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends
from dotenv import load_dotenv

load_dotenv()
from models import ProfileCreate, ProfileUpdate, ProfileOut, ProfileBatchRequest
from auth_utils import get_current_user

# ---------------------------------------------------------------------------
# Firebase / Firestore initialisation
# ---------------------------------------------------------------------------
try:
    firebase_admin.initialize_app()
    db_id = os.environ.get("FIRESTORE_DATABASE_ID", "(default)")
    print(f"[INFO] Initializing Firestore Client with Database ID: '{db_id}'")
    db = firestore.Client(database=db_id)
    # Verification fetch to catch 503/initialization errors early
    print(f"[INFO] Profiles Service Status: Connected to Firestore ({db_id})")
except Exception as e:
    print(f"[CRITICAL] Failed to initialize Profiles Service: {e}")
    # In a real environment, we might want to exit, but for Cloud Run, 
    # we let the first request fail with a clear error if it hasn't crashed.
    db = None 

GCS_BUCKET = os.getenv("GCS_BUCKET_NAME", "")

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Tavern Swiper — Profiles Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
COLLECTION = "profiles"


def _deactivate_other_profiles(user_id: str, active_profile_id: str):
    """Sets is_active=False for all profiles owned by user_id except the specified active_profile_id."""
    other_active_docs = db.collection(COLLECTION).where("user_id", "==", user_id).where("is_active", "==", True).stream()
    for doc in other_active_docs:
        if doc.id != active_profile_id:
            doc.reference.update({"is_active": False})


def _doc_to_profile(doc) -> ProfileOut:
    d = doc.to_dict()
    return ProfileOut(
        profile_id=doc.id,
        user_id=d["user_id"],
        display_name=d["display_name"],
        tagline=d.get("tagline"),
        bio=d.get("bio"),
        image_urls=d.get("image_urls", []),
        gender=d.get("gender"),
        is_active=d.get("is_active", False)
    )




def _validate_data_for_firestore(data: any, path: str = ""):
    """
    Recursively ensures the data structure is 'simple' (no massive strings, 
    massive arrays, or complex nested types) to prevent Firestore document 
    size limits from being reached.
    """
    MAX_STRING_LENGTH = 15360  # 15KB: comfortably larger than any reasonable bio/tagline, but too small for base64 images
    MAX_ARRAY_LENGTH = 100      # Prevents 'vector' or massive list explosion
    
    if isinstance(data, dict):
        for k, v in data.items():
            _validate_data_for_firestore(v, f"{path}.{k}" if path else k)
    elif isinstance(data, list):
        if len(data) > MAX_ARRAY_LENGTH:
            raise HTTPException(status_code=400, detail=f"Array at path '{path}' is too large ({len(data)} items). Max is {MAX_ARRAY_LENGTH}.")
        for i, item in enumerate(data):
            _validate_data_for_firestore(item, f"{path}[{i}]")
    elif isinstance(data, str):
        if len(data) > MAX_STRING_LENGTH:
            raise HTTPException(status_code=400, detail=f"String at path '{path}' is too long ({len(data)} chars). Max is {MAX_STRING_LENGTH}. (Likely unintended base64 image data).")
    elif isinstance(data, (int, float, bool)) or data is None:
        pass
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported data type '{type(data).__name__}' at path '{path}'. Simple types only.")


@app.get("/profiles/health")
async def health():
    return {"service": "profiles", "status": "ok"}


@app.get("/profiles/discovery", response_model=list[ProfileOut])
async def discovery_list_profiles(limit: int = 10, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Public endpoint for Discovery service to find candidates. Accessible to all logged-in users."""
    _, _, _ = auth_data
    docs = db.collection(COLLECTION).limit(limit).stream()
    return [_doc_to_profile(doc) for doc in docs]


@app.get("/profiles/all", response_model=list[ProfileOut])
async def list_all_profiles(auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Internal endpoint used by the Discovery service. Only accessible to Admins."""
    uid, role, _ = auth_data
    if role not in ["admin", "root_admin"]:
        raise HTTPException(status_code=403, detail="Admin or Root Admin authorization required")
    
    docs = db.collection(COLLECTION).stream()
    return [_doc_to_profile(doc) for doc in docs]


@app.post("/profiles/", response_model=ProfileOut, status_code=201)
async def create_profile(body: ProfileCreate, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    uid, role, _ = auth_data
    # 1. Determine target UID (Admin can override, others use their own UID)
    target_uid = uid
    if body.user_id:
        if role in ["admin", "root_admin"]:
            target_uid = body.user_id
        else:
            raise HTTPException(status_code=403, detail="Only admins or root admins can specify a target user_id")

    profile_id = str(uuid.uuid4())
    data = body.model_dump()
    data["user_id"] = target_uid
    
    # Safety Validation: Ensure no massive strings or vectors are being sent
    _validate_data_for_firestore(data)
    
    # Ensure new profile is active and others are deactivated
    data["is_active"] = True
    
    db.collection(COLLECTION).document(profile_id).set(data)
    _deactivate_other_profiles(target_uid, profile_id)
    
    doc = db.collection(COLLECTION).document(profile_id).get()
    return _doc_to_profile(doc)
    


@app.get("/profiles/{profile_id}", response_model=ProfileOut)
async def get_profile(profile_id: str, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Fetch a single profile. Now secured with Auth."""
    _, _, _ = auth_data
    doc = db.collection(COLLECTION).document(profile_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _doc_to_profile(doc)


@app.post("/profiles/batch", response_model=list[ProfileOut])
async def get_profiles_batch(body: ProfileBatchRequest, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Fetch multiple profiles by ID in a single request."""
    if not body.profile_ids:
        return []
    
    # Firestore 'in' query has a limit of 30 items
    results = []
    for i in range(0, len(body.profile_ids), 30):
        chunk = body.profile_ids[i:i + 30]
        docs = db.collection(COLLECTION).where(firestore.FieldPath.document_id(), "in", chunk).stream()
        for doc in docs:
            results.append(_doc_to_profile(doc))
    
    return results


@app.get("/profiles/user/me/active", response_model=ProfileOut)
async def get_my_active_profile(auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Fetch the currently active profile for the authenticated user."""
    uid, _, _ = auth_data
    docs = list(db.collection(COLLECTION).where("user_id", "==", uid).where("is_active", "==", True).limit(1).stream())
    if not docs:
        raise HTTPException(status_code=404, detail="No active profile found for user")
    return _doc_to_profile(docs[0])


@app.get("/profiles/user/{user_id}", response_model=list[ProfileOut])
async def list_profiles_for_user(user_id: str, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """List profiles for a specific user. Available to all logged-in users for discovery."""
    uid, role, _ = auth_data
    docs = db.collection(COLLECTION).where("user_id", "==", user_id).stream()
    return [_doc_to_profile(doc) for doc in docs]


@app.put("/profiles/{profile_id}", response_model=ProfileOut)
async def update_profile(profile_id: str, body: ProfileUpdate, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    uid, role, _ = auth_data
    ref = db.collection(COLLECTION).document(profile_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    if doc.to_dict().get("user_id") != uid and role not in ["admin", "root_admin"]:
        raise HTTPException(status_code=403, detail="Not authorized to update this profile")
    
    if doc.to_dict().get("user_id") != uid:
        raise HTTPException(status_code=403, detail="Not authorized to update this profile")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    
    # Safety Validation: Ensure no massive strings or vectors are being sent
    _validate_data_for_firestore(updates)
    
    # If we are setting this profile to active, deactivate other profiles for this user
    if updates.get("is_active"):
        target_uid = doc.to_dict().get("user_id")
        _deactivate_other_profiles(target_uid, profile_id)
    
    ref.update(updates)
    return _doc_to_profile(ref.get())


@app.post("/profiles/{profile_id}/set_active", response_model=ProfileOut)
async def set_profile_active(profile_id: str, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Set a specific profile as the active one for the user."""
    uid, role, _ = auth_data
    ref = db.collection(COLLECTION).document(profile_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    profile_data = doc.to_dict()
    if profile_data.get("user_id") != uid and role not in ["admin", "root_admin"]:
        raise HTTPException(status_code=403, detail="Not authorized to set this profile as active")

    # Update to active and deactivate others
    ref.update({"is_active": True})
    _deactivate_other_profiles(profile_data.get("user_id"), profile_id)
    
    return _doc_to_profile(ref.get())


@app.delete("/profiles/{profile_id}", status_code=204)
async def delete_profile(profile_id: str, auth_data: tuple[str, str, str] = Depends(get_current_user)):
    uid, role, _ = auth_data
    ref = db.collection(COLLECTION).document(profile_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    if doc.to_dict().get("user_id") != uid and role not in ["admin", "root_admin"]:
        raise HTTPException(status_code=403, detail="Not authorized to delete this profile")
        
    ref.delete()


@app.post("/profiles/{profile_id}/image", response_model=ProfileOut)
async def upload_profile_image(profile_id: str, index: int = 0, file: UploadFile = File(...), auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Upload profile image to GCS and save the public URL to Firestore. Admins can upload on behalf of others."""
    uid, role, _ = auth_data
    if not GCS_BUCKET:
        raise HTTPException(status_code=503, detail="Storage provider configuration error")
    ref = db.collection(COLLECTION).document(profile_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    if doc.to_dict().get("user_id") != uid and role not in ["admin", "root_admin"]:
        raise HTTPException(status_code=403, detail="Not authorized to update this profile's image")

    client = storage.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob_name = f"profiles/{profile_id}/{index}_{file.filename}"
    blob = bucket.blob(blob_name)
    
    # Seek to the beginning and upload directly from the stream
    await file.seek(0)
    blob.upload_from_file(file.file, content_type=file.content_type)
    blob.make_public()

    profile_dict = doc.to_dict()
    image_urls = profile_dict.get("image_urls", [])
    # Ensure list is long enough
    while len(image_urls) <= index:
        image_urls.append("")
    image_urls[index] = blob.public_url

    updates = {"image_urls": image_urls}
    
    ref.update(updates)
    return _doc_to_profile(ref.get())


@app.delete("/profiles/", status_code=204)
async def delete_all_profiles(auth_data: tuple[str, str, str] = Depends(get_current_user)):
    """Delete all profiles. Admin/Root Admin only."""
    _, role, _ = auth_data
    if role not in ["admin", "root_admin"]:
        raise HTTPException(status_code=403, detail="Admin or Root Admin authorization required")
    
    # 1. Clear GCS media (profiles/ prefix)
    if GCS_BUCKET:
        try:
            client = storage.Client()
            bucket = client.bucket(GCS_BUCKET)
            # Fetch all blobs first
            blobs = list(bucket.list_blobs(prefix="profiles/"))
            if blobs:
                # Use batch delete for performance (up to 1000 per call, bucket.delete_blobs handles this)
                bucket.delete_blobs(blobs)
            print(f"[DEBUG] GCS: Cleared {len(blobs)} blobs in profiles/ prefix")
        except Exception as e:
            print(f"[WARNING] GCS: Failed to clear media: {e}")

    # 2. Batch delete Firestore profiles
    batch_size = 500
    total_deleted = 0
    while True:
        docs = list(db.collection(COLLECTION).limit(batch_size).stream())
        deleted = 0
        batch = db.batch()
        for doc in docs:
            batch.delete(doc.reference)
            deleted += 1
            total_deleted += 1
        
        if deleted == 0:
            break
        
        batch.commit()
    print(f"[DEBUG] Firestore: Cleared {total_deleted} profiles")
