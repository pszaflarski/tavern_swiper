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
# Firebase / Firestore initialisation
# ---------------------------------------------------------------------------
db = firestore.Client(database=os.getenv("FIRESTORE_DATABASE_ID", "(default)"))
users_db = firestore.Client(database=os.getenv("USERS_DATABASE_ID", "users"))
firebase_admin.initialize_app()

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
    try:
        decoded = firebase_auth.verify_id_token(body.id_token)
    except firebase_admin.auth.InvalidIdTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
    except firebase_admin.auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Auth unavailable: {e}")

    uid = decoded["uid"]
    
    # Fetch role from users database
    role = "user"
    try:
        user_doc = users_db.collection("users").document(uid).get()
        if user_doc.exists:
            role = user_doc.to_dict().get("user_type", "user")
    except Exception as e:
        print(f"Warning: Failed to fetch role for {uid}: {e}")
        # Default to 'user' if lookup fails

    return TokenResponse(
        uid=uid,
        role=role
    )

FIREBASE_WEB_API_KEY = os.getenv("FIREBASE_WEB_API_KEY", "")

@app.post("/auth/register", response_model=AuthResponse)
async def register_user(body: LoginRequest):
    """Registers a new user using Firebase Authentication REST API and returns an ID token."""
    if not FIREBASE_WEB_API_KEY:
        raise HTTPException(status_code=503, detail="FIREBASE_WEB_API_KEY is not configured")
        
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
        error_msg = response.json().get("error", {}).get("message", "Registration failed")
        raise HTTPException(status_code=400, detail=error_msg)
        
    data = response.json()
    return AuthResponse(id_token=data["idToken"], uid=data["localId"])

@app.post("/auth/login", response_model=AuthResponse)
async def login_user(body: LoginRequest):
    """Logs in an existing user using Firebase Authentication REST API and returns an ID token."""
    if not FIREBASE_WEB_API_KEY:
        raise HTTPException(status_code=503, detail="FIREBASE_WEB_API_KEY is not configured")
        
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
        error_msg = response.json().get("error", {}).get("message", "Authentication failed")
        raise HTTPException(status_code=401, detail=error_msg)
        
    data = response.json()
    return AuthResponse(id_token=data["idToken"], uid=data["localId"])

@app.delete("/auth/users/{uid}", status_code=204)
async def delete_auth_user(uid: str):
    """Delete a specific user from Firebase Authentication."""
    try:
        firebase_auth.delete_user(uid)
    except firebase_admin.auth.UserNotFoundError:
        # If user not in Auth, consider it a success
        pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete auth user: {e}")

@app.delete("/auth/users/", status_code=204)
async def delete_auth_users_bulk(body: BulkDeleteRequest):
    """Bulk delete users from Firebase Authentication."""
    try:
        if not body.uids:
            return
        # Firebase Admin SDK supports bulk deletion
        result = firebase_auth.delete_users(body.uids)
        if result.errors:
            # Optionally log errors but continue
            print(f"Auth bulk delete errors: {len(result.errors)} failed")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed bulk auth delete: {e}")
@app.delete("/auth/all", status_code=204)
async def delete_all_auth_users():
    """Delete all users from Firebase Authentication. High-risk operation."""
    try:
        # Iterate through all users and delete in batches
        page = firebase_auth.list_users()
        while page:
            uids = [user.uid for user in page.users]
            if uids:
                firebase_auth.delete_users(uids)
            page = page.get_next_page()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear all auth users: {e}")
