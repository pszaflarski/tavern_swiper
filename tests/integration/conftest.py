import pytest
import httpx
from .helpers import get_root_admin


@pytest.fixture(scope="session")
async def auth_token():
    """Session-scoped fixture: ensures root admin exists and returns its token and UID."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        root = await get_root_admin(client)
        return root
