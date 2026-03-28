import os
import uuid
import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore, storage
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends
from dotenv import load_dotenv

load_dotenv()
from models import ProfileCreate, ProfileUpdate, ProfileOut, CoreAttributes
from auth_utils import get_current_user

# ---------------------------------------------------------------------------
# Firebase / Firestore initialisation
# ---------------------------------------------------------------------------
_cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
if _cred_path:
    cred = credentials.Certificate(_cred_path)
    firebase_admin.initialize_app(cred)
else:
    firebase_admin.initialize_app()

db = firestore.Client(database=os.getenv("FIRESTORE_DATABASE_ID", "(default)"))
GCS_BUCKET = os.getenv("GCS_BUCKET_NAME", "")

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Trystr — Profiles Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
COLLECTION = "profiles"


def _doc_to_profile(doc) -> ProfileOut:
    d = doc.to_dict()
    attrs = d.get("attributes", {})
    return ProfileOut(
        profile_id=doc.id,
        user_id=d["user_id"],
        display_name=d["display_name"],
        tagline=d.get("tagline"),
        bio=d.get("bio"),
        character_class=d.get("character_class"),
        realm=d.get("realm"),
        talents=d.get("talents", []),
        attributes=CoreAttributes(**attrs),
        image_url=d.get("image_url"),
        gender=d.get("gender"),
    )


@app.get("/profiles/health")
async def health():
    return {"service": "profiles", "status": "ok"}


@app.get("/profiles/all", response_model=list[ProfileOut])
async def list_all_profiles():
    """Internal endpoint used by the Discovery service to build feed candidates."""
    docs = db.collection(COLLECTION).stream()
    return [_doc_to_profile(doc) for doc in docs]


@app.post("/profiles/", response_model=ProfileOut, status_code=201)
async def create_profile(body: ProfileCreate, uid: str = Depends(get_current_user)):
    profile_id = str(uuid.uuid4())
    data = body.model_dump()
    data["user_id"] = uid  # Enforce authenticated UID
    data["attributes"] = body.attributes.model_dump()
    db.collection(COLLECTION).document(profile_id).set(data)
    doc = db.collection(COLLECTION).document(profile_id).get()
    return _doc_to_profile(doc)


@app.get("/profiles/{profile_id}", response_model=ProfileOut)
async def get_profile(profile_id: str):
    doc = db.collection(COLLECTION).document(profile_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _doc_to_profile(doc)


@app.get("/profiles/user/{user_id}", response_model=list[ProfileOut])
async def list_profiles_for_user(user_id: str):
    docs = db.collection(COLLECTION).where("user_id", "==", user_id).stream()
    return [_doc_to_profile(doc) for doc in docs]


@app.put("/profiles/{profile_id}", response_model=ProfileOut)
async def update_profile(profile_id: str, body: ProfileUpdate, uid: str = Depends(get_current_user)):
    ref = db.collection(COLLECTION).document(profile_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    if doc.to_dict().get("user_id") != uid:
        raise HTTPException(status_code=403, detail="Not authorized to update this profile")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if "attributes" in updates and updates["attributes"]:
        updates["attributes"] = body.attributes.model_dump()
    ref.update(updates)
    return _doc_to_profile(ref.get())


@app.delete("/profiles/{profile_id}", status_code=204)
async def delete_profile(profile_id: str, uid: str = Depends(get_current_user)):
    ref = db.collection(COLLECTION).document(profile_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    if doc.to_dict().get("user_id") != uid:
        raise HTTPException(status_code=403, detail="Not authorized to delete this profile")
        
    ref.delete()


@app.post("/profiles/{profile_id}/image", response_model=ProfileOut)
async def upload_profile_image(profile_id: str, file: UploadFile = File(...)):
    """Upload profile image to GCS and save the public URL to Firestore."""
    if not GCS_BUCKET:
        raise HTTPException(status_code=503, detail="GCS_BUCKET_NAME not configured")
    ref = db.collection(COLLECTION).document(profile_id)
    if not ref.get().exists:
        raise HTTPException(status_code=404, detail="Profile not found")

    client = storage.Client()
    bucket = client.bucket(GCS_BUCKET)
    blob_name = f"profiles/{profile_id}/{file.filename}"
    blob = bucket.blob(blob_name)
    contents = await file.read()
    blob.upload_from_string(contents, content_type=file.content_type)
    blob.make_public()

    ref.update({"image_url": blob.public_url})
    return _doc_to_profile(ref.get())
