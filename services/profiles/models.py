from pydantic import BaseModel
from typing import Optional, List


class CoreAttributes(BaseModel):
    strength: int = 5       # Physical power
    charisma: int = 5       # Charm in the Tavern of Conversation
    spark: int = 5          # Romantic chemistry / alchemy


class ProfileCreate(BaseModel):
    display_name: str
    tagline: Optional[str] = None
    bio: Optional[str] = None
    character_class: Optional[str] = None   # e.g. Ranger, Bard, Scholar
    realm: Optional[str] = None             # Location / hometown
    talents: List[str] = []                 # Hobbies / Affinity Sigils
    attributes: CoreAttributes = CoreAttributes()
    image_urls: List[str] = []
    gender: Optional[str] = None
    user_id: Optional[str] = None


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    tagline: Optional[str] = None
    bio: Optional[str] = None
    character_class: Optional[str] = None
    realm: Optional[str] = None
    talents: Optional[List[str]] = None
    attributes: Optional[CoreAttributes] = None
    image_urls: Optional[List[str]] = None
    gender: Optional[str] = None


class ProfileOut(BaseModel):
    profile_id: str
    user_id: str
    display_name: str
    tagline: Optional[str] = None
    bio: Optional[str] = None
    character_class: Optional[str] = None
    realm: Optional[str] = None
    talents: List[str] = []
    attributes: CoreAttributes
    image_urls: List[str] = []
    gender: Optional[str] = None
