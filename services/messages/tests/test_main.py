import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

# Mock firestore before importing app
with patch("google.cloud.firestore.Client"):
    from main import app, SWIPES_SERVICE_URL, PROFILES_SERVICE_URL

client = TestClient(app)

@pytest.fixture
def mock_auth_service():
    with respx.mock as respx_mock:
        respx_mock.post("http://auth:8001/auth/verify").mock(
            return_value=Response(200, json={"uid": "u1"})
        )
        yield respx_mock

@respx.mock
@patch("main.db")
def test_send_message_success(mock_db, respx_mock):
    # 1. Auth mock
    respx_mock.post("http://auth:8001/auth/verify").mock(return_value=Response(200, json={"uid": "u1"}))
    
    # 2. Match details mock
    respx_mock.get(f"{SWIPES_SERVICE_URL}/swipes/matches/m1").mock(
        return_value=Response(200, json={
            "match_id": "m1",
            "profile_id_a": "p1",
            "profile_id_b": "p2",
            "created_at": "2024-01-01"
        })
    )
    
    # 3. Profile ownership mock (u1 owns p1)
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(
        return_value=Response(200, json={"user_id": "u1"})
    )
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p2").mock(
        return_value=Response(200, json={"user_id": "u2"})
    )
    
    payload = {"match_id": "m1", "sender_profile_id": "p1", "content": "Hail!"}
    headers = {"Authorization": "Bearer token"}
    response = client.post("/messages/", json=payload, headers=headers)
    assert response.status_code == 201

@respx.mock
def test_send_message_forbidden(respx_mock):
    # u1 tries to access match m1, but m1 is between p2 and p3 (u2 and u3)
    respx_mock.post("http://auth:8001/auth/verify").mock(return_value=Response(200, json={"uid": "u1"}))
    respx_mock.get(f"{SWIPES_SERVICE_URL}/swipes/matches/m1").mock(
        return_value=Response(200, json={
            "match_id": "m1",
            "profile_id_a": "p2",
            "profile_id_b": "p3",
            "created_at": "2024-01-01"
        })
    )
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p2").mock(return_value=Response(200, json={"user_id": "u2"}))
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p3").mock(return_value=Response(200, json={"user_id": "u3"}))
    
    payload = {"match_id": "m1", "sender_profile_id": "p2", "content": "Hack!"}
    headers = {"Authorization": "Bearer token"}
    response = client.post("/messages/", json=payload, headers=headers)
    assert response.status_code == 403
    assert "Not authorized for this match" in response.json()["detail"]
