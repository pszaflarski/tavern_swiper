import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import respx
from httpx import Response
import os
import jwt
import datetime

# Test JWT settings
JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-tavern-key-123")
JWT_ALGORITHM = "HS256"

def sign_test_token(uid="test-user-123", role="user"):
    payload = {
        "sub": uid,
        "role": role,
        "iat": datetime.datetime.utcnow(),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=30)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

# Mock firestore and firebase before importing app
with patch("google.cloud.firestore.Client"), \
     patch("firebase_admin.credentials.Certificate"), \
     patch("firebase_admin.initialize_app"):
    from main import app

client = TestClient(app)

@pytest.fixture
def mock_firestore():
    with patch("main.db") as mock:
        yield mock

@pytest.fixture
def mock_auth_service():
    """No longer mocks network, just provides a standard fixture signature if needed."""
    yield None

def test_health():
    response = client.get("/users/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_consolidated_create_root_admin(mock_firestore, mock_auth_service):
    # Mock no root admin exists
    mock_firestore.collection().where().limit().stream.return_value = []
    # Mock user doesn't exist
    mock_firestore.collection().document().get().exists = False

    payload = {"email": "root@e.com", "user_type": "root_admin"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/users/", json=payload, headers=headers)
    
    assert response.status_code == 201
    assert response.json()["user_type"] == "root_admin"


def test_consolidated_create_root_admin_fails_if_exists(mock_firestore, mock_auth_service):
    # Mock root admin ALREADY exists
    mock_firestore.collection().where().limit().stream.return_value = [MagicMock()]

    payload = {"email": "root2@e.com", "user_type": "root_admin"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/users/", json=payload, headers=headers)
    
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]


def test_consolidated_self_registration(mock_firestore, mock_auth_service):
    # Mock user doesn't exist
    mock_firestore.collection().document().get().exists = False

    payload = {"email": "user@e.com", "user_type": "user"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/users/", json=payload, headers=headers)
    
    assert response.status_code == 201
    assert response.json()["uid"] == "test-user-123"


def test_consolidated_self_registration_as_admin_fails(mock_firestore, mock_auth_service):
    payload = {"email": "hacker@e.com", "user_type": "admin"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/users/", json=payload, headers=headers)
    
    assert response.status_code == 403
    assert "self-register as 'user' type" in response.json()["detail"]


def test_consolidated_admin_creation(mock_firestore, mock_auth_service):
    # Mock caller IS admin
    mock_admin_doc = MagicMock()
    mock_admin_doc.exists = True
    mock_admin_doc.to_dict.return_value = {"user_type": "admin"}
    mock_admin_doc.get.return_value = mock_admin_doc
    
    # Mock target doesn't exist
    mock_target_doc = MagicMock()
    mock_target_doc.exists = False
    mock_target_doc.get.return_value = mock_target_doc

    def side_effect(uid):
        if uid == "admin-user-456": return mock_admin_doc
        return mock_target_doc

    mock_firestore.collection().document.side_effect = side_effect

    payload = {
        "email": "newbie@e.com",
        "user_type": "user",
        "uid": "target-uid"
    }
    headers = {"Authorization": f"Bearer {sign_test_token(uid='admin-user-456', role='admin')}"}
    response = client.post("/users/", json=payload, headers=headers)
    
    assert response.status_code == 201
    assert response.json()["uid"] == "target-uid"
    mock_target_doc.set.assert_called()

def test_get_me(mock_firestore, mock_auth_service):
    # Mock user exists
    mock_doc = MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {
        "email": "test@example.com",
        "is_premium": True,
        "created_at": "2026-03-26T12:00:00Z"
    }
    mock_firestore.collection().document().get.return_value = mock_doc

    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/users/me", headers=headers)
    
    assert response.status_code == 200
    assert response.json()["uid"] == "test-user-123"
    assert response.json()["is_premium"] is True

def test_unauthorized():
    response = client.get("/users/me", headers={"Authorization": "Bearer invalid-jwt"})
    assert response.status_code == 401


def test_check_root_admin_exists(mock_firestore):
    # Mock exists
    mock_firestore.collection().where().stream.return_value = [MagicMock()]
    response = client.get("/users/root-admin-exists")
    assert response.status_code == 200
    assert response.json()["exists"] is True

    # Mock not exists
    mock_firestore.collection().where().stream.return_value = []
    response = client.get("/users/root-admin-exists")
    assert response.status_code == 200
    assert response.json()["exists"] is False


def test_list_users_admin(mock_firestore, mock_auth_service):
    # Mock current user IS admin
    mock_admin_doc = MagicMock()
    mock_admin_doc.exists = True
    mock_admin_doc.to_dict.return_value = {"user_type": "admin"}
    mock_firestore.collection().document().get.return_value = mock_admin_doc

    # Mock some users in the stream
    mock_user_1 = MagicMock()
    mock_user_1.id = "user1"
    mock_user_1.to_dict.return_value = {"email": "u1@e.com", "user_type": "user", "created_at": "2026-03-26T12:00:00Z"}
    mock_firestore.collection().stream.return_value = [mock_user_1]

    headers = {"Authorization": f"Bearer {sign_test_token(uid='admin-user-456', role='admin')}"}
    response = client.get("/users/", headers=headers)
    
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["uid"] == "user1"


def test_delete_user_admin(mock_firestore, mock_auth_service):
    # Mock current user IS admin
    mock_admin_doc = MagicMock()
    mock_admin_doc.exists = True
    mock_admin_doc.to_dict.return_value = {"user_type": "admin"}
    mock_admin_doc.get.return_value = mock_admin_doc
    
    # Mock target user exists and is NOT root
    mock_target_doc = MagicMock()
    mock_target_doc.exists = True
    mock_target_doc.to_dict.return_value = {"user_type": "user"}
    mock_target_doc.get.return_value = mock_target_doc

    def side_effect(uid):
        if uid == "admin-user-456": return mock_admin_doc
        return mock_target_doc
    
    mock_firestore.collection().document.side_effect = side_effect

    headers = {"Authorization": f"Bearer {sign_test_token(uid='admin-user-456', role='admin')}"}
    response = client.delete("/users/user1", headers=headers)
    
    assert response.status_code == 204
    mock_target_doc.update.assert_called_with({"is_deleted": True})


def test_purge_all_users_root(mock_firestore, mock_auth_service):
    # Mock caller IS root_admin
    mock_root_doc = MagicMock()
    mock_root_doc.exists = True
    mock_root_doc.to_dict.return_value = {"user_type": "root_admin"}
    mock_root_doc.get.return_value = mock_root_doc

    # Mock some users to delete
    mock_doc_1 = MagicMock()
    mock_doc_1.reference = MagicMock()
    mock_firestore.collection().stream.return_value = [mock_doc_1]

    def side_effect(uid):
        if uid == "root-user-789": return mock_root_doc
        return MagicMock()

    mock_firestore.collection().document.side_effect = side_effect

    headers = {"Authorization": f"Bearer {sign_test_token(uid='root-user-789', role='root_admin')}"}
    response = client.delete("/users/", headers=headers)
    
    assert response.status_code == 204
    mock_firestore.batch().delete.assert_called()
    mock_firestore.batch().commit.assert_called()


def test_purge_all_users_non_root_fails(mock_firestore, mock_auth_service):
    # Mock caller IS NOT root_admin (he is just admin)
    mock_admin_doc = MagicMock()
    mock_admin_doc.exists = True
    mock_admin_doc.to_dict.return_value = {"user_type": "admin"}
    mock_admin_doc.get.return_value = mock_admin_doc

    mock_firestore.collection().document.return_value = mock_admin_doc

    headers = {"Authorization": f"Bearer {sign_test_token(uid='admin-user-456', role='admin')}"}
    response = client.delete("/users/", headers=headers)
    assert response.status_code == 403
    assert "Root Admin authority required" in response.json()["detail"]

def test_delete_root_admin_unauthorized(mock_firestore):
    # Mock caller is ADMIN
    mock_admin_doc = MagicMock()
    mock_admin_doc.exists = True
    mock_admin_doc.to_dict.return_value = {"user_type": "admin"}
    mock_admin_doc.get.return_value = mock_admin_doc # ref.get() returns doc
    
    # Mock target is ROOT_ADMIN
    mock_target_doc = MagicMock()
    mock_target_doc.exists = True
    mock_target_doc.to_dict.return_value = {"user_type": "root_admin"}
    mock_target_doc.get.return_value = mock_target_doc # ref.get() returns doc

    def side_effect(uid):
        if uid == "admin-uid": return mock_admin_doc
        return mock_target_doc
    
    mock_firestore.collection().document.side_effect = side_effect
    
    headers = {"Authorization": f"Bearer {sign_test_token(uid='admin-uid', role='admin')}"}
    response = client.delete("/users/root-uid", headers=headers)
    assert response.status_code == 403
    assert "Only a Root Admin can delete another Root Admin" in response.json()["detail"]

def test_delete_last_root_admin_fails(mock_firestore):
    # Mock caller is ROOT_ADMIN
    mock_root_doc = MagicMock()
    mock_root_doc.exists = True
    mock_root_doc.to_dict.return_value = {"user_type": "root_admin"}
    mock_root_doc.get.return_value = mock_root_doc # ref.get() returns doc
    
    # Mock query returns only 1 active root admin
    mock_root_doc_query = MagicMock()
    mock_root_doc_query.to_dict.return_value = {"user_type": "root_admin", "is_deleted": False}
    mock_firestore.collection().where().stream.return_value = [mock_root_doc_query]
    
    # Setup the document reference mock
    mock_firestore.collection().document.return_value = mock_root_doc
    
    headers = {"Authorization": f"Bearer {sign_test_token(uid='root-uid', role='root_admin')}"}
    response = client.delete("/users/root-uid", headers=headers)
    assert response.status_code == 400
    assert "last active root admin" in response.json()["detail"]
    
    headers = {"Authorization": f"Bearer {sign_test_token(uid='root-uid', role='root_admin')}"}
    response = client.delete("/users/root-uid", headers=headers)
    assert response.status_code == 400
    assert "last active root admin" in response.json()["detail"]

def test_auth_expired_token():
    exp = datetime.datetime.utcnow() - datetime.timedelta(minutes=10)
    token = jwt.encode({"sub": "u1", "role": "user", "iat": exp, "exp": exp}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    headers = {"Authorization": f"Bearer {token}"}
    response = client.get("/users/me", headers=headers)
    assert response.status_code == 401

def test_auth_invalid_signature():
    token = jwt.encode({"sub": "u1", "role": "user"}, "WRONG_SECRET", algorithm=JWT_ALGORITHM)
    headers = {"Authorization": f"Bearer {token}"}
    response = client.get("/users/me", headers=headers)
    assert response.status_code == 401

def test_update_me_success(mock_firestore, mock_auth_service):
    # Mock user exists
    mock_ref = MagicMock()
    mock_ref.get().exists = True
    mock_ref.get().to_dict.return_value = {
        "email": "test@e.com",
        "user_type": "user",
        "is_premium": True,
        "is_deleted": False,
        "created_at": datetime.datetime.now(tz=datetime.timezone.utc)
    }
    
    mock_firestore.collection().document.return_value = mock_ref
    
    payload = {"is_premium": True}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    response = client.put("/users/me", json=payload, headers=headers)
    assert response.status_code == 200
    mock_ref.update.assert_called()

def test_restore_user_success(mock_firestore, mock_auth_service):
    # Mock admin user
    mock_admin_doc = MagicMock()
    mock_admin_doc.exists = True
    mock_admin_doc.to_dict.return_value = {"user_type": "admin"}
    
    # Mock target user exists
    mock_target_ref = MagicMock()
    mock_target_ref.get().exists = True
    mock_target_ref.get().to_dict.return_value = {
        "email": "u1@e.com",
        "user_type": "user",
        "is_premium": False,
        "is_deleted": False,
        "created_at": datetime.datetime.now(tz=datetime.timezone.utc)
    }
    
    def side_effect(uid):
        if uid == "admin-uid": return mock_admin_doc
        return mock_target_ref
        
    mock_firestore.collection().document.side_effect = side_effect
    
    headers = {"Authorization": f"Bearer {sign_test_token(uid='admin-uid', role='admin')}"}
    response = client.patch("/users/user1/restore", headers=headers)
    
    assert response.status_code == 200
    mock_target_ref.update.assert_called_with({"is_deleted": False})

@pytest.mark.asyncio
async def test_purge_all_users_auth_failure_resilience(mock_firestore):
    # Mock caller IS root_admin
    mock_root_doc = MagicMock(); mock_root_doc.exists = True; mock_root_doc.to_dict.return_value = {"user_type": "root_admin"}
    mock_firestore.collection().document.return_value = mock_root_doc
    
    # Mock some users
    mock_doc = MagicMock(); mock_doc.id = "u1"; mock_doc.reference = MagicMock()
    mock_firestore.collection().stream.return_value = [mock_doc]
    
    # Mock Auth service failure
    with respx.mock:
        respx.delete(f"{os.getenv('AUTH_SERVICE_URL', 'http://localhost:8001')}/auth/users/").mock(return_value=Response(500))
        
        headers = {"Authorization": f"Bearer {sign_test_token(role='root_admin')}"}
        response = client.delete("/users/", headers=headers)
        
        # Should still succeed (returns 204) as Firestore purge continues
        assert response.status_code == 204
        mock_firestore.batch().delete.assert_called()
