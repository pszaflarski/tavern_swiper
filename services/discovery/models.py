from pydantic import BaseModel
from typing import Optional, List


# Minimal profile representation used only within this service.
# Discovery fetches full data from the Profiles service over HTTP.
class DiscoveryProfile(BaseModel):
    profile_id: str
    display_name: str
    tagline: Optional[str] = None
    bio: Optional[str] = None
    gender: Optional[str] = None
    image_urls: List[str] = []
    is_active: bool = False
    # Fantasy-themed fields for future use
    character_class: Optional[str] = None
    realm: Optional[str] = None
    talents: List[str] = []


class FeedResponse(BaseModel):
    profiles: List[DiscoveryProfile]


class SwipeCreate(BaseModel):
    swiper_profile_id: str
    swiped_profile_id: str
    direction: str  # 'left' or 'right'


class SwipeOut(BaseModel):
    swipe_id: str
    swiper_profile_id: str
    swiped_profile_id: str
    direction: str
    created_at: str
    match_id: Optional[str] = None


class MatchOut(BaseModel):
    match_id: str
    profiles: List[str]
    created_at: str
