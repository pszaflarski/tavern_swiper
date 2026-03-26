from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class MessageCreate(BaseModel):
    match_id: str
    sender_profile_id: str
    content: str


class MessageOut(BaseModel):
    message_id: str
    match_id: str
    sender_profile_id: str
    content: str
    sent_at: datetime
