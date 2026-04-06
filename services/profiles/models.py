from pydantic import BaseModel
from typing import Optional, List


class ProfileCreate(BaseModel):
    display_name: str
    tagline: Optional[str] = None
    bio: Optional[str] = None
    gender: Optional[str] = None
    image_urls: List[str] = []
    user_id: Optional[str] = None
    is_active: bool = True


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    tagline: Optional[str] = None
    bio: Optional[str] = None
    gender: Optional[str] = None
    image_urls: Optional[List[str]] = None
    is_active: Optional[bool] = None


class ProfileOut(BaseModel):
    profile_id: str
    user_id: str
    display_name: str
    tagline: Optional[str] = None
    bio: Optional[str] = None
    gender: Optional[str] = None
    image_urls: List[str] = []
    is_active: bool = False


