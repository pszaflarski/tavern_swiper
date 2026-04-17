import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from main import app

client = TestClient(app)

def test_health(snapshot):
    response = client.get("/auth/health")
    assert response.status_code == 200
    assert response.json() == snapshot

@patch("firebase_admin.auth.verify_id_token")
def test_verify_token_success(mock_verify, snapshot):
    # Mock decoded token
    mock_verify.return_value = {
        "uid": "test-uid-123",
        "email": "test@example.com",
        "email_verified": True
    }
    
    response = client.post("/auth/verify", json={"id_token": "valid-token"})
    
    assert response.status_code == 200
    # Capture snapshot
    assert response.json() == snapshot

@patch("firebase_admin.auth.verify_id_token")
def test_verify_token_invalid(mock_verify, snapshot):
    from firebase_admin import auth as firebase_auth
    mock_verify.side_effect = firebase_auth.InvalidIdTokenError("Invalid")
    
    response = client.post("/auth/verify", json={"id_token": "invalid-token"})
    assert response.status_code == 401
    assert response.json() == snapshot

@patch("firebase_admin.auth.verify_id_token")
def test_verify_token_expired(mock_verify, snapshot):
    from firebase_admin import auth as firebase_auth
    mock_verify.side_effect = firebase_auth.ExpiredIdTokenError("Expired", None)
    
    response = client.post("/auth/verify", json={"id_token": "expired-token"})
    assert response.status_code == 401
    assert response.json() == snapshot

@pytest.mark.asyncio
@patch("httpx.AsyncClient.post")
async def test_register_user_email_exists_mapping(mock_post, snapshot):
    # Mocking httpx response
    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.json.return_value = {"error": {"message": "EMAIL_EXISTS"}}
    mock_post.return_value = mock_response
    
    response = client.post("/auth/register", json={"email": "exists@example.com", "password": "password123"})
    
    assert response.status_code == 400
    assert response.json() == snapshot

@pytest.mark.asyncio
@patch("httpx.AsyncClient.post")
async def test_login_user_invalid_password_mapping(mock_post, snapshot):
    # Mocking httpx response
    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.json.return_value = {"error": {"message": "INVALID_PASSWORD"}}
    mock_post.return_value = mock_response
    
    response = client.post("/auth/login", json={"email": "user@example.com", "password": "wrong-password"})
    
    assert response.status_code == 401
    assert response.json() == snapshot

@pytest.mark.asyncio
@patch("httpx.AsyncClient.post")
async def test_register_user_generic_error_mapping(mock_post, snapshot):
    # Mocking httpx response
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.json.return_value = {"error": {"message": "UNKNOWN_FIREBASE_ERROR"}}
    mock_post.return_value = mock_response
    
    response = client.post("/auth/register", json={"email": "new@example.com", "password": "password123"})
    
    assert response.status_code == 400
    assert response.json() == snapshot

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

# --- NEW TESTS ---

@pytest.mark.asyncio
@patch("httpx.AsyncClient.post")
async def test_register_user_success(mock_post, snapshot):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "idToken": "fake-id-token",
        "localId": "fake-uid"
    }
    mock_post.return_value = mock_response
    
    response = client.post("/auth/register", json={"email": "new@example.com", "password": "password123"})
    
    assert response.status_code == 200
    assert response.json() == snapshot

@pytest.mark.asyncio
@patch("httpx.AsyncClient.post")
async def test_login_user_success(mock_post, snapshot):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "idToken": "fake-login-token",
        "localId": "fake-uid"
    }
    mock_post.return_value = mock_response
    
    response = client.post("/auth/login", json={"email": "user@example.com", "password": "correct-password"})
    
    assert response.status_code == 200
    assert response.json() == snapshot

def test_login_invalid_body_422():
    # Missing password should trigger 422
    response = client.post("/auth/login", json={"email": "user@example.com"})
    assert response.status_code == 422
    assert "password" in str(response.json())

@patch("main.FIREBASE_WEB_API_KEY", "")
@pytest.mark.asyncio
async def test_register_user_missing_config_530(snapshot):
    # Patching main.FIREBASE_WEB_API_KEY directly because it's loaded at module level
    response = client.post("/auth/register", json={"email": "new@example.com", "password": "password123"})
    assert response.status_code == 503
    assert response.json() == snapshot

@pytest.mark.asyncio
@patch("httpx.AsyncClient.post")
async def test_register_user_external_down_503(mock_post, snapshot):
    import httpx
    mock_post.side_effect = httpx.HTTPError("Network down")
    
    response = client.post("/auth/register", json={"email": "new@example.com", "password": "password123"})
    assert response.status_code == 503
    assert response.json() == snapshot

@patch("firebase_admin.auth.verify_id_token")
def test_verify_token_service_unavailable_503(mock_verify, snapshot):
    mock_verify.side_effect = Exception("Firebase is down")
    
    response = client.post("/auth/verify", json={"id_token": "valid-token"})
    assert response.status_code == 503
    assert response.json() == snapshot

@patch("main.get_users_db")
@patch("firebase_admin.auth.verify_id_token")
def test_verify_token_role_fallback_success(mock_verify, mock_get_users_db, snapshot):
    mock_verify.return_value = {"uid": "u1", "email": "e1"}
    # Simulate DB error when fetching role
    mock_get_users_db.side_effect = Exception("DB Error")
    
    response = client.post("/auth/verify", json={"id_token": "valid-token"})
    assert response.status_code == 200
    assert response.json() == snapshot

@patch("firebase_admin.auth.delete_user")
def test_delete_auth_user_not_found_idempotent(mock_delete):
    from firebase_admin import auth as firebase_auth
    mock_delete.side_effect = firebase_auth.UserNotFoundError("Not Found")
    
    response = client.delete("/auth/users/non-existent")
    assert response.status_code == 204 # Should still be success

@patch("firebase_admin.auth.delete_user")
def test_delete_auth_user_failure_500(mock_delete):
    mock_delete.side_effect = Exception("Crash")
    
    response = client.delete("/auth/users/test-uid")
    assert response.status_code == 500
    assert "failed to process" in response.json()["detail"].lower()

@patch("firebase_admin.auth.delete_users")
def test_delete_auth_users_bulk_failure_500(mock_delete_bulk):
    mock_delete_bulk.side_effect = Exception("Crash")
    
    response = client.request("DELETE", "/auth/users/", json={"uids": ["u1"]})
    assert response.status_code == 500

def test_delete_auth_users_bulk_empty_list():
    response = client.request("DELETE", "/auth/users/", json={"uids": []})
    assert response.status_code == 204

# --- GAP FILL TESTS (Oracle Bolstering) ---

def test_register_invalid_body_422():
    # Missing password should trigger 422
    response = client.post("/auth/register", json={"email": "new@example.com"})
    assert response.status_code == 422

@patch("main.FIREBASE_WEB_API_KEY", "")
def test_login_missing_config_503():
    # Missing API key should trigger 503
    response = client.post("/auth/login", json={"email": "user@example.com", "password": "correct-password"})
    assert response.status_code == 503

@patch("httpx.AsyncClient.post")
@pytest.mark.asyncio
async def test_login_external_down_503(mock_post):
    import httpx
    mock_post.side_effect = httpx.HTTPError("Network down")
    # External error should trigger 503
    response = client.post("/auth/login", json={"email": "user@example.com", "password": "correct-password"})
    assert response.status_code == 503

@patch("firebase_admin.auth.list_users")
def test_delete_all_auth_users_failure_500(mock_list):
    mock_list.side_effect = Exception("Crash")
    # Backend crash should trigger 500
    response = client.delete("/auth/all")
    assert response.status_code == 500
