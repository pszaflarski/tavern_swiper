import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient
from unittest.mock import patch
import os
import jwt
import datetime

JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-tavern-key-123")
JWT_ALGORITHM = "HS256"

def sign_test_token(uid="u1", role="user"):
    payload = {
        "sub": uid,
        "role": role,
        "iat": datetime.datetime.utcnow(),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=30)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

# Mock firestore before importing app
with patch("google.cloud.firestore.Client"):
    from main import app, PROFILES_SERVICE_URL

client = TestClient(app)

@pytest.fixture
def mock_profiles():
    return [
        {"profile_id": "p1", "display_name": "Aragorn", "is_active": True, "image_urls": []},
        {"profile_id": "p2", "display_name": "Legolas", "is_active": True, "image_urls": []},
        {"profile_id": "p3", "display_name": "Gimli", "is_active": True, "image_urls": []},
    ]

@pytest.fixture
def mock_auth_service():
    """Activates respx to mock cross-service calls."""
    with respx.mock as respx_mock:
        yield respx_mock

@pytest.mark.asyncio
async def test_get_feed_success(mock_auth_service, mock_profiles):
    respx_mock = mock_auth_service
    
    # Mock Profiles Service (ownership check for p1)
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(
        return_value=Response(200, json={"user_id": "u1"})
    )
    
    # Mock Profiles Service: returns all profiles via discovery endpoint
    respx_mock.get(url__startswith=f"{PROFILES_SERVICE_URL}/profiles/discovery").mock(
        return_value=Response(200, json=mock_profiles)
    )
    
    # Note: Firestore 'swipes' query is mocked via patch("google.cloud.firestore.Client")
    # and will return an empty stream by default, meaning p2 and p3 should both show up
    # except p1 (the swiper).
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/discovery/feed/p1", headers=headers)
    
    assert response.status_code == 200
    profiles = response.json()["profiles"]
    # Expecting p2 and p3 (p1 excluded because it's the requester)
    assert len(profiles) == 2

@pytest.mark.asyncio
async def test_get_feed_unauthorized_profile(mock_auth_service):
    respx_mock = mock_auth_service
    # Mock Profiles Service: p1 belongs to u2
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(
        return_value=Response(200, json={"user_id": "u2"})
    )
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/discovery/feed/p1", headers=headers)
    assert response.status_code == 403

def test_health():
    response = client.get("/discovery/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
