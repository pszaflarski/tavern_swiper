import httpx
import os
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth:8001")
security = HTTPBearer()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """
    Dependency to verify the Firebase JWT via the internal Auth service.
    Returns the decoded user UID if valid, otherwise raises 401.
    """
    token = credentials.credentials
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(
                f"{AUTH_SERVICE_URL}/auth/verify",
                json={"id_token": token}
            )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=f"Auth verification failed: {resp.text}"
                )
            user_data = resp.json()
            return user_data["uid"], token
        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Auth service unavailable: {e}"
            )
