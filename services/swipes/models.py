from pydantic import BaseModel
from typing import Literal, Optional
from datetime import datetime


class SwipeCreate(BaseModel):
    swiper_profile_id: str
    swiped_profile_id: str
    direction: Literal["left", "right"]


class SwipeOut(BaseModel):
    swipe_id: str
    swiper_profile_id: str
    swiped_profile_id: str
    direction: Literal["left", "right"]
    created_at: datetime


class MatchOut(BaseModel):
    match_id: str
    profile_id_a: str
    profile_id_b: str
    created_at: datetime
