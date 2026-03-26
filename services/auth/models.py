from pydantic import BaseModel
from typing import Optional


class TokenRequest(BaseModel):
    id_token: str


class TokenResponse(BaseModel):
    uid: str
    email: Optional[str] = None
    email_verified: bool = False
