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
    assert "token" in data
    assert data["token"] is not None

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

@patch("firebase_admin.auth.delete_user")
def test_delete_auth_user_success(mock_delete):
    mock_delete.return_value = None
    response = client.delete("/auth/users/test-uid")
    assert response.status_code == 204
    mock_delete.assert_called_once_with("test-uid")

@patch("firebase_admin.auth.delete_users")
def test_delete_auth_users_bulk_success(mock_delete_bulk):
    mock_result = MagicMock()
    mock_result.errors = []
    mock_delete_bulk.return_value = mock_result
    
    response = client.request("DELETE", "/auth/users/", json={"uids": ["u1", "u2"]})
    assert response.status_code == 204
    mock_delete_bulk.assert_called_once_with(["u1", "u2"])

@patch("firebase_admin.auth.list_users")
@patch("firebase_admin.auth.delete_users")
def test_delete_all_auth_users_success(mock_delete_bulk, mock_list):
    # Mock page 1
    mock_user_1 = MagicMock(); mock_user_1.uid = "u1"
    mock_page_1 = MagicMock()
    mock_page_1.users = [mock_user_1]
    
    # Mock page 2 (empty)
    mock_page_1.get_next_page.return_value = None
    
    mock_list.return_value = mock_page_1
    
    response = client.delete("/auth/all")
    assert response.status_code == 204
    mock_delete_bulk.assert_called_once_with(["u1"])
