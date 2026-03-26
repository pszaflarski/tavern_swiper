import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import respx
from httpx import Response

# Mock firestore before importing app
with patch("google.cloud.firestore.Client"):
    from main import app

client = TestClient(app)

@pytest.fixture
def mock_firestore():
    with patch("main.db") as mock:
        yield mock

@pytest.fixture
def mock_auth_service():
    with respx.mock as respx_mock:
        # Mock the internal auth service call
        respx_mock.post("http://auth:8001/auth/verify").mock(
            return_value=Response(200, json={"uid": "test-user-123"})
        )
        yield respx_mock

def test_health():
    response = client.get("/users/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_create_user(mock_firestore, mock_auth_service):
    # Mock firestore doc doesn't exist
    mock_doc = MagicMock()
    mock_doc.exists = False
    mock_firestore.collection().document().get.return_value = mock_doc

    payload = {
        "email": "test@example.com",
        "full_name": "Test User",
        "is_premium": False
    }
    
    headers = {"Authorization": "Bearer fake-token"}
    response = client.post("/users/", json=payload, headers=headers)
    
    assert response.status_code == 201
    assert response.json()["uid"] == "test-user-123"
    assert response.json()["email"] == "test@example.com"
    mock_firestore.collection().document().set.assert_called_once()

def test_get_me(mock_firestore, mock_auth_service):
    # Mock user exists
    mock_doc = MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {
        "email": "test@example.com",
        "full_name": "Test User",
        "is_premium": True,
        "created_at": "2026-03-26T12:00:00Z"
    }
    mock_firestore.collection().document().get.return_value = mock_doc

    headers = {"Authorization": "Bearer fake-token"}
    response = client.get("/users/me", headers=headers)
    
    assert response.status_code == 200
    assert response.json()["uid"] == "test-user-123"
    assert response.json()["is_premium"] is True

def test_unauthorized(mock_auth_service):
    # Mock auth failure
    mock_auth_service.post("http://auth:8001/auth/verify").mock(
        return_value=Response(401, text="Invalid token")
    )
    
    response = client.get("/users/me", headers={"Authorization": "Bearer invalid"})
    assert response.status_code == 401
