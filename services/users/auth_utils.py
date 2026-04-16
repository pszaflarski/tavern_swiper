import jwt
import os
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-tavern-key-123")
JWT_ALGORITHM = "HS256"
security = HTTPBearer()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """
    Dependency to verify the custom Tavern JWT locally.
    Returns the decoded user info if valid, otherwise raises 401.
    """
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        uid = payload.get("sub")
        role = payload.get("role", "user")
        email = payload.get("email", "")
        if not uid:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        return uid, role, email, token
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Tavern token has expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid Tavern token: {e}")
