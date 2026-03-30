import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone
import os

# Mock firestore before importing app
with patch("google.cloud.firestore.Client"):
    from main import app, PROFILES_SERVICE_URL

client = TestClient(app)

@pytest.fixture
def mock_auth_service():
    with respx.mock as respx_mock:
        auth_url = os.getenv("AUTH_SERVICE_URL", "http://auth:8001")
        respx_mock.post(f"{auth_url}/auth/verify").mock(
            return_value=Response(200, json={"uid": "u1", "role": "user"})
        )
        yield respx_mock

@pytest.fixture
def mock_profiles_service():
    with respx.mock as respx_mock:
        respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(
            return_value=Response(200, json={"user_id": "u1"})
        )
        yield respx_mock

def test_health():
    response = client.get("/swipes/health")
    assert response.status_code == 200

@patch("main.db")
def test_record_swipe_unauthorized(mock_db, mock_auth_service):
    # User u1 tries to swipe for p1, but p1 belongs to u2
    respx_mock = mock_auth_service
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(return_value=Response(200, json={"user_id": "u2"}))
    
    payload = {"swiper_profile_id": "p1", "swiped_profile_id": "p2", "direction": "left"}
    headers = {"Authorization": "Bearer token"}
    response = client.post("/swipes/", json=payload, headers=headers)
    assert response.status_code == 403

@patch("main.db")
def test_record_swipe_success(mock_db, mock_auth_service, mock_profiles_service):
    # p1 belongs to u1 (authenticated user)
    respx_mock = mock_auth_service
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(return_value=Response(200, json={"user_id": "u1"}))
    
    payload = {"swiper_profile_id": "p1", "swiped_profile_id": "p2", "direction": "left"}
    headers = {"Authorization": "Bearer token"}
    
    # Mock reverse swipe (no match)
    mock_db.collection.return_value.where.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = iter([])
    
    response = client.post("/swipes/", json=payload, headers=headers)
    assert response.status_code == 201

@patch("main.db")
def test_list_matches_success(mock_db, mock_auth_service, mock_profiles_service):
    respx_mock = mock_auth_service
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(return_value=Response(200, json={"user_id": "u1"}))
    
    headers = {"Authorization": "Bearer token"}
    response = client.get("/swipes/matches/p1", headers=headers)
    assert response.status_code == 200
