import os
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv
from google.cloud import firestore
import httpx
from models import TokenRequest, TokenResponse, LoginRequest, AuthResponse, BulkDeleteRequest

load_dotenv()

# ---------------------------------------------------------------------------
# Firebase / Firestore initialisation (Lazy Loading)
# ---------------------------------------------------------------------------
# We initialize these lazily to satisfy Cloud Run's startup probe faster.
_db = None
_users_db = None
_firebase_initialized = False

def get_db():
    global _db
    if _db is None:
        _db = firestore.Client(database=os.environ["FIRESTORE_DATABASE_ID"])
    return _db

def get_users_db():
    global _users_db
    if _users_db is None:
        _users_db = firestore.Client(database=os.environ["USERS_DATABASE_ID"])
    return _users_db

def ensure_firebase_initialized():
    global _firebase_initialized
    if not _firebase_initialized:
        firebase_admin.initialize_app()
        _firebase_initialized = True

from fastapi.middleware.cors import CORSMiddleware

# ---------------------------------------------------------------------------
# Identity Provider Service
# This service is the "Source of Truth" for credentials and authentication
# tokens. It manages Firebase Auth users and provides an internal API for
# profile services (like the Users service) to verify and manage identities.
# ---------------------------------------------------------------------------
app = FastAPI(title="Tavern Swiper — Auth Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/auth/health")
async def health():
    return {"service": "auth", "status": "ok"}


@app.post("/auth/verify", response_model=TokenResponse)
async def verify_token(body: TokenRequest):
    """Verify a Firebase Auth ID token and return decoded user info."""
    ensure_firebase_initialized()
    try:
        decoded = firebase_auth.verify_id_token(body.id_token)
    except firebase_admin.auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except firebase_admin.auth.InvalidIdTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token")
    except Exception:
        raise HTTPException(status_code=503, detail="Authentication service temporarily unavailable")

    uid = decoded["uid"]
    
    # Fetch role from users database
    role = "user"
    try:
        user_doc = get_users_db().collection("users").document(uid).get()
        if user_doc.exists:
            role = user_doc.to_dict().get("user_type", "user")
    except Exception as e:
        print(f"Warning: Failed to fetch role for {uid}: {e}")
        # Default to 'user' if lookup fails

    return TokenResponse(
        uid=uid,
        role=role
    )

def map_firebase_error(message: str) -> str:
    """Map Firebase REST API error messages to generic, user-friendly ones."""
    if "EMAIL_EXISTS" in message:
        return "An account with this email address already exists."
    if "INVALID_PASSWORD" in message:
        return "Incorrect password. Please try again."
    if "USER_NOT_FOUND" in message or "EMAIL_NOT_FOUND" in message:
        return "No account found with this email address."
    if "TOO_MANY_ATTEMPTS_TRY_LATER" in message:
        return "Too many failed attempts. Please try again later."
    if "INVALID_EMAIL" in message:
        return "The email address is invalid."
    if "WEAK_PASSWORD" in message:
        return "The password is too weak."
    return "An unexpected authentication error occurred. Please try again."

FIREBASE_WEB_API_KEY = os.getenv("FIREBASE_WEB_API_KEY", "")

@app.post("/auth/register", response_model=AuthResponse)
async def register_user(body: LoginRequest):
    """Registers a new user using Firebase Authentication REST API and returns an ID token."""
    if not FIREBASE_WEB_API_KEY:
        raise HTTPException(status_code=503, detail="Authentication provider configuration error")
        
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={FIREBASE_WEB_API_KEY}"
    payload = {
        "email": body.email,
        "password": body.password,
        "returnSecureToken": True
    }
    
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload)
        
    if response.status_code != 200:
        error_data = response.json().get("error", {})
        original_msg = error_data.get("message", "Registration failed")
        error_msg = map_firebase_error(original_msg)
        raise HTTPException(status_code=400, detail=error_msg)
        
    data = response.json()
    return AuthResponse(id_token=data["idToken"], uid=data["localId"])

@app.post("/auth/login", response_model=AuthResponse)
async def login_user(body: LoginRequest):
    """Logs in an existing user using Firebase Authentication REST API and returns an ID token."""
    if not FIREBASE_WEB_API_KEY:
        raise HTTPException(status_code=503, detail="Authentication provider configuration error")
        
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_WEB_API_KEY}"
    payload = {
        "email": body.email,
        "password": body.password,
        "returnSecureToken": True
    }
    
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=payload)
        
    if response.status_code != 200:
        error_data = response.json().get("error", {})
        original_msg = error_data.get("message", "Authentication failed")
        error_msg = map_firebase_error(original_msg)
        raise HTTPException(status_code=401, detail=error_msg)
        
    data = response.json()
    return AuthResponse(id_token=data["idToken"], uid=data["localId"])

@app.delete("/auth/users/{uid}", status_code=204)
async def delete_auth_user(uid: str):
    """Delete a specific user from Firebase Authentication."""
    ensure_firebase_initialized()
    try:
        firebase_auth.delete_user(uid)
    except firebase_admin.auth.UserNotFoundError:
        # If user not in Auth, consider it a success
        pass
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to process user identity deletion")

@app.delete("/auth/users/", status_code=204)
async def delete_auth_users_bulk(body: BulkDeleteRequest):
    """Bulk delete users from Firebase Authentication."""
    ensure_firebase_initialized()
    try:
        if not body.uids:
            return
        # Firebase Admin SDK supports bulk deletion
        result = firebase_auth.delete_users(body.uids)
        if result.errors:
            # Optionally log errors but continue
            print(f"Auth bulk delete errors: {len(result.errors)} failed")
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to process bulk identity deletion")
@app.delete("/auth/all", status_code=204)
async def delete_all_auth_users():
    """Delete all users from Firebase Authentication. High-risk operation."""
    ensure_firebase_initialized()
    try:
        # Iterate through all users and delete in batches
        page = firebase_auth.list_users()
        while page:
            uids = [user.uid for user in page.users]
            if uids:
                firebase_auth.delete_users(uids)
            page = page.get_next_page()
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to clear identity store")
