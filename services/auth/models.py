from pydantic import BaseModel
from typing import Optional

class TokenRequest(BaseModel):
    id_token: str

class TokenResponse(BaseModel):
    uid: str
