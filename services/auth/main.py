import os
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from fastapi import FastAPI, HTTPException
from models import TokenRequest, TokenResponse

# ---------------------------------------------------------------------------
# Firebase initialisation — uses GOOGLE_APPLICATION_CREDENTIALS env var
# ---------------------------------------------------------------------------
_cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
if _cred_path:
    cred = credentials.Certificate(_cred_path)
    firebase_admin.initialize_app(cred)
else:
    # When credentials are not present (e.g., CI / first run) initialise with
    # default so the app still starts; /auth/verify will return 503.
    firebase_admin.initialize_app()

app = FastAPI(title="Trystr — Auth Service", version="1.0.0")


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

    return TokenResponse(
        uid=decoded["uid"]
    )
