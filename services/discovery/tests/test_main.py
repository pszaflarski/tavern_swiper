import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient
from unittest.mock import patch

# Mock firestore before importing app
with patch("google.cloud.firestore.Client"):
    from main import app, PROFILES_SERVICE_URL, SWIPES_SERVICE_URL

client = TestClient(app)

@pytest.fixture
def mock_profiles():
    return [
        {"profile_id": "p1", "user_id": "u1", "display_name": "Aragorn", "attributes": {}},
        {"profile_id": "p2", "user_id": "u2", "display_name": "Legolas", "attributes": {}},
        {"profile_id": "p3", "user_id": "u3", "display_name": "Gimli", "attributes": {}},
    ]

@respx.mock
def test_get_feed_success(respx_mock, mock_profiles):
    # Mock Auth Service
    respx_mock.post("http://auth:8001/auth/verify").mock(
        return_value=Response(200, json={"uid": "u1"})
    )
    
    # Mock Profiles Service (ownership check for p1)
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(
        return_value=Response(200, json={"user_id": "u1"})
    )
    
    # Mock Swipes Service: already swiped p2
    respx_mock.get(f"{SWIPES_SERVICE_URL}/swipes/swiped-by/p1").mock(
        return_value=Response(200, json={"profile_ids": ["p2"]})
    )
    
    # Mock Profiles Service: returns all profiles
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/all").mock(
        return_value=Response(200, json=mock_profiles)
    )
    
    headers = {"Authorization": "Bearer fake-token"}
    response = client.get("/discovery/feed/p1", headers=headers)
    
    assert response.status_code == 200
    profiles = response.json()["profiles"]
    assert len(profiles) == 1
    assert profiles[0]["profile_id"] == "p3"

@respx.mock
def test_get_feed_unauthorized_profile(respx_mock):
    # Mock Auth Service: user is u1
    respx_mock.post("http://auth:8001/auth/verify").mock(
        return_value=Response(200, json={"uid": "u1"})
    )
    # Mock Profiles Service: p1 belongs to u2
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(
        return_value=Response(200, json={"user_id": "u2"})
    )
    
    headers = {"Authorization": "Bearer fake-token"}
    response = client.get("/discovery/feed/p1", headers=headers)
    assert response.status_code == 403

def test_health():
    response = client.get("/discovery/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
