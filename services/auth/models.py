from pydantic import BaseModel
from typing import Optional

class TokenRequest(BaseModel):
    id_token: str

class TokenResponse(BaseModel):
    uid: str

class LoginRequest(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    id_token: str
    uid: str

class BulkDeleteRequest(BaseModel):
    uids: list[str]
