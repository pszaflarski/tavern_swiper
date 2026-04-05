from pydantic import BaseModel
from typing import Optional, List


# Minimal profile representation used only within this service.
# Discovery fetches full data from the Profiles service over HTTP.
class DiscoveryProfile(BaseModel):
    profile_id: str
    display_name: str
    tagline: Optional[str] = None
    character_class: Optional[str] = None
    realm: Optional[str] = None
    image_urls: List[str] = []
    talents: List[str] = []


class FeedResponse(BaseModel):
    profiles: List[DiscoveryProfile]
