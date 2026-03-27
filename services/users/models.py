from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
from enum import Enum

class UserType(str, Enum):
    USER = "user"
    ADMIN = "admin"
    ROOT_ADMIN = "root_admin"

class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    is_premium: bool = False
    user_type: UserType = UserType.USER

class UserCreate(UserBase):
    uid: Optional[str] = None

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    is_premium: Optional[bool] = None
    user_type: Optional[UserType] = None

class UserOut(UserBase):
    uid: str
    created_at: datetime
