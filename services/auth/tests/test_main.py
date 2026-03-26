import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from main import app

client = TestClient(app)

def test_health():
    response = client.get("/auth/health")
    assert response.status_code == 200
    assert response.json() == {"service": "auth", "status": "ok"}

@patch("firebase_admin.auth.verify_id_token")
def test_verify_token_success(mock_verify):
    # Mock decoded token
    mock_verify.return_value = {
        "uid": "test-uid-123",
        "email": "test@example.com",
        "email_verified": True
    }
    
    response = client.post("/auth/verify", json={"id_token": "valid-token"})
    
    assert response.status_code == 200
    data = response.json()
    assert data["uid"] == "test-uid-123"

@patch("firebase_admin.auth.verify_id_token")
def test_verify_token_invalid(mock_verify):
    from firebase_admin import auth as firebase_auth
    mock_verify.side_effect = firebase_auth.InvalidIdTokenError("Invalid")
    
    response = client.post("/auth/verify", json={"id_token": "invalid-token"})
    assert response.status_code == 401
    assert "Invalid token" in response.json()["detail"]

@patch("firebase_admin.auth.verify_id_token")
def test_verify_token_expired(mock_verify):
    from firebase_admin import auth as firebase_auth
    mock_verify.side_effect = firebase_auth.ExpiredIdTokenError("Expired", None)
    
    response = client.post("/auth/verify", json={"id_token": "expired-token"})
    assert response.status_code == 401
    assert "expired" in response.json()["detail"].lower()
