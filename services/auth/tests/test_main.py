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
    assert response.json()["detail"] == "Invalid authentication token"

@patch("firebase_admin.auth.verify_id_token")
def test_verify_token_expired(mock_verify):
    from firebase_admin import auth as firebase_auth
    mock_verify.side_effect = firebase_auth.ExpiredIdTokenError("Expired", None)
    
    response = client.post("/auth/verify", json={"id_token": "expired-token"})
    assert response.status_code == 401
    assert "expired" in response.json()["detail"].lower()

@pytest.mark.asyncio
@patch("httpx.AsyncClient.post")
async def test_register_user_email_exists_mapping(mock_post):
    # Mocking httpx response
    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.json.return_value = {"error": {"message": "EMAIL_EXISTS"}}
    mock_post.return_value = mock_response
    
    response = client.post("/auth/register", json={"email": "exists@example.com", "password": "password123"})
    
    assert response.status_code == 400
    assert response.json()["detail"] == "An account with this email address already exists."

@pytest.mark.asyncio
@patch("httpx.AsyncClient.post")
async def test_login_user_invalid_password_mapping(mock_post):
    # Mocking httpx response
    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.json.return_value = {"error": {"message": "INVALID_PASSWORD"}}
    mock_post.return_value = mock_response
    
    response = client.post("/auth/login", json={"email": "user@example.com", "password": "wrong-password"})
    
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect password. Please try again."

@pytest.mark.asyncio
@patch("httpx.AsyncClient.post")
async def test_register_user_generic_error_mapping(mock_post):
    # Mocking httpx response
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.json.return_value = {"error": {"message": "UNKNOWN_FIREBASE_ERROR"}}
    mock_post.return_value = mock_response
    
    response = client.post("/auth/register", json={"email": "new@example.com", "password": "password123"})
    
    assert response.status_code == 400
    assert "unexpected authentication error" in response.json()["detail"].lower()
    assert "firebase" not in response.json()["detail"].lower()
