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

def sign_test_token(uid="test-user-123", role="user", email="test@e.com", iat=None):
    now = iat or datetime.datetime(2026, 4, 17, 10, 0, 0, tzinfo=datetime.timezone.utc)
    payload = {
        "sub": uid,
        "role": role,
        "email": email,
        "iat": now,
        "exp": now + datetime.timedelta(days=365)
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
def mock_now():
    fixed_now = datetime.datetime(2026, 4, 17, 10, 0, 0, tzinfo=datetime.timezone.utc)
    with patch("main._now", return_value=fixed_now):
        yield fixed_now

@pytest.fixture
def mock_auth_service():
    """No longer mocks network, just provides a standard fixture signature if needed."""
    yield None

def test_health(snapshot):
    response = client.get("/users/health")
    assert response.status_code == 200
    assert response.json() == snapshot

def test_consolidated_create_root_admin(mock_firestore, mock_auth_service, mock_now, snapshot):
    # Mock no root admin exists
    mock_firestore.collection().where().limit().stream.return_value = []
    # Mock user doesn't exist
    mock_firestore.collection().document().get().exists = False

    payload = {"email": "root@e.com", "user_type": "root_admin"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/users/", json=payload, headers=headers)
    
    assert response.status_code == 201
    assert response.json() == snapshot


def test_consolidated_create_root_admin_fails_if_exists(mock_firestore, mock_auth_service, snapshot):
    # Mock root admin ALREADY exists
    mock_firestore.collection().where().limit().stream.return_value = [MagicMock()]

    payload = {"email": "root2@e.com", "user_type": "root_admin"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/users/", json=payload, headers=headers)
    
    assert response.status_code == 400
    assert response.json() == snapshot


def test_consolidated_self_registration(mock_firestore, mock_auth_service, mock_now, snapshot):
    # Mock user doesn't exist
    mock_firestore.collection().document().get().exists = False

    payload = {"email": "user@e.com", "user_type": "user"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/users/", json=payload, headers=headers)
    
    assert response.status_code == 201
    assert response.json() == snapshot


def test_consolidated_self_registration_as_admin_fails(mock_firestore, mock_auth_service):
    payload = {"email": "hacker@e.com", "user_type": "admin"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/users/", json=payload, headers=headers)
    
    assert response.status_code == 403
    assert "self-register as 'user' type" in response.json()["detail"]


def test_consolidated_admin_creation(mock_firestore, mock_auth_service, mock_now, snapshot):
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
    assert response.json() == snapshot
    mock_target_doc.set.assert_called()

def test_get_me(mock_firestore, mock_auth_service, snapshot):
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
    assert response.json() == snapshot

def test_unauthorized():
    response = client.get("/users/me", headers={"Authorization": "Bearer invalid-jwt"})
    assert response.status_code == 401


def test_check_root_admin_exists(mock_firestore, snapshot):
    # Mock exists
    mock_firestore.collection().where().stream.return_value = [MagicMock()]
    response = client.get("/users/root-admin-exists")
    assert response.status_code == 200
    assert response.json() == snapshot

    # Mock not exists
    mock_firestore.collection().where().stream.return_value = []
    response = client.get("/users/root-admin-exists")
    assert response.status_code == 200
    assert response.json() == snapshot


def test_list_users_admin(mock_firestore, mock_auth_service, snapshot):
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
    assert response.json() == snapshot


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

def test_delete_root_admin_unauthorized(mock_firestore, snapshot):
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
    assert response.json() == snapshot

def test_delete_last_root_admin_fails(mock_firestore, snapshot):
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
    assert response.json() == snapshot

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

def test_update_me_success(mock_firestore, mock_auth_service, mock_now, snapshot):
    # Mock user exists
    mock_ref = MagicMock()
    mock_ref.get().exists = True
    mock_ref.get().to_dict.return_value = {
        "email": "test@e.com",
        "user_type": "user",
        "is_premium": True,
        "is_deleted": False,
        "created_at": mock_now
    }
    
    mock_firestore.collection().document.return_value = mock_ref
    
    payload = {"is_premium": True}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    response = client.put("/users/me", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json() == snapshot
    mock_ref.update.assert_called()

def test_restore_user_success(mock_firestore, mock_auth_service, mock_now, snapshot):
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
        "created_at": mock_now
    }
    
    def side_effect(uid):
        if uid == "admin-uid": return mock_admin_doc
        return mock_target_ref
        
    mock_firestore.collection().document.side_effect = side_effect
    
    headers = {"Authorization": f"Bearer {sign_test_token(uid='admin-uid', role='admin')}"}
    response = client.patch("/users/user1/restore", headers=headers)
    
    assert response.status_code == 200
    assert response.json() == snapshot
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

# --- New Bolstered Tests ---

def test_get_me_self_healing(mock_firestore, mock_now, snapshot):
    # Mock user DOES NOT exist
    mock_ref = MagicMock()
    mock_ref.get().exists = False
    mock_firestore.collection().document.return_value = mock_ref

    headers = {"Authorization": f"Bearer {sign_test_token(email='new@e.com')}"}
    response = client.get("/users/me", headers=headers)
    
    assert response.status_code == 200
    assert response.json() == snapshot
    mock_ref.set.assert_called()

def test_update_me_not_found(mock_firestore, snapshot):
    mock_ref = MagicMock()
    mock_ref.get().exists = False
    mock_firestore.collection().document.return_value = mock_ref

    payload = {"is_premium": True}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.put("/users/me", json=payload, headers=headers)
    
    assert response.status_code == 404
    assert response.json() == snapshot

def test_update_me_validation_error(snapshot):
    payload = {"is_premium": "not-a-bool"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.put("/users/me", json=payload, headers=headers)
    
    assert response.status_code == 422
    # Snapshot for 422 is useful to see FastAPI's default error structure
    assert response.json() == snapshot

def test_delete_user_not_found(mock_firestore, snapshot):
    # Mock caller IS admin
    mock_admin_doc = MagicMock()
    mock_admin_doc.exists = True
    mock_admin_doc.to_dict.return_value = {"user_type": "admin"}
    mock_admin_doc.get.return_value = mock_admin_doc
    
    # Mock target NOT found
    mock_target_ref = MagicMock()
    mock_target_ref.get().exists = False
    
    def side_effect(uid):
        if uid == "admin-uid": return mock_admin_doc
        return mock_target_ref
    
    mock_firestore.collection().document.side_effect = side_effect
    headers = {"Authorization": f"Bearer {sign_test_token(uid='admin-uid', role='admin')}"}
    response = client.delete("/users/missing", headers=headers)
    
    assert response.status_code == 404
    assert response.json() == snapshot

def test_delete_user_hard_success(mock_firestore, mock_auth_service, snapshot):
    # Mock caller IS admin
    mock_admin_doc = MagicMock()
    mock_admin_doc.exists = True
    mock_admin_doc.to_dict.return_value = {"user_type": "admin"}
    mock_admin_doc.get.return_value = mock_admin_doc
    
    # Mock target exists
    mock_target_ref = MagicMock()
    mock_target_ref.get().exists = True
    mock_target_ref.get().to_dict.return_value = {"user_type": "user"}
    
    def side_effect(uid):
        if uid == "admin-uid": return mock_admin_doc
        return mock_target_ref
    
    mock_firestore.collection().document.side_effect = side_effect
    
    with respx.mock:
        respx.delete(f"{os.getenv('AUTH_SERVICE_URL', 'http://localhost:8001')}/auth/users/u1").mock(return_value=Response(204))
        
        headers = {"Authorization": f"Bearer {sign_test_token(uid='admin-uid', role='admin')}"}
        response = client.delete("/users/u1?hard=True", headers=headers)
        
        assert response.status_code == 204
        mock_target_ref.delete.assert_called()

def test_restore_user_not_found(mock_firestore, snapshot):
    # Mock admin caller
    mock_admin_doc = MagicMock(); mock_admin_doc.exists = True; mock_admin_doc.to_dict.return_value = {"user_type": "admin"}
    
    # Mock target doc MISSING
    mock_target_ref = MagicMock(); mock_target_ref.get().exists = False
    
    def side_effect(uid):
        if uid == "admin-uid": return mock_admin_doc
        return mock_target_ref
        
    mock_firestore.collection().document.side_effect = side_effect
    headers = {"Authorization": f"Bearer {sign_test_token(uid='admin-uid', role='admin')}"}
    response = client.patch("/users/missing/restore", headers=headers)
    
    assert response.status_code == 404
    assert response.json() == snapshot

def test_create_user_idempotency_self(mock_firestore, mock_now, snapshot):
    # Mock user ALREADY exists
    mock_doc = MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {
        "email": "existing@e.com",
        "user_type": "user",
        "is_premium": False,
        "is_deleted": False,
        "created_at": "2026-03-26T12:00:00Z"
    }
    mock_firestore.collection().document().get.return_value = mock_doc

    payload = {"email": "existing@e.com", "user_type": "user"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/users/", json=payload, headers=headers)
    
    # Should return existing record with 200/201 (App says 201 in return UserOut but existing check returns UserOut directly)
    # Wait, main.py:250 returns UserOut(uid=target_uid, **existing_doc.to_dict())
    assert response.status_code == 201
    assert response.json() == snapshot

def test_list_users_unauthorized(snapshot):
    headers = {"Authorization": f"Bearer {sign_test_token(role='user')}"}
    response = client.get("/users/", headers=headers)
    assert response.status_code == 403
    assert response.json() == snapshot

def test_list_users_include_deleted(mock_firestore, snapshot):
    # Mock admin caller
    mock_admin_doc = MagicMock(); mock_admin_doc.exists = True; mock_admin_doc.to_dict.return_value = {"user_type": "admin"}
    mock_firestore.collection().document().get.return_value = mock_admin_doc
    
    # Mock users: one active, one deleted
    mock_u1 = MagicMock(); mock_u1.id = "u1"; mock_u1.to_dict.return_value = {"email": "u1@e.com", "is_deleted": False, "user_type": "user", "created_at": "2026-03-26T12:00:00Z"}
    mock_u2 = MagicMock(); mock_u2.id = "u2"; mock_u2.to_dict.return_value = {"email": "u2@e.com", "is_deleted": True, "user_type": "user", "created_at": "2026-03-26T12:00:00Z"}
    mock_firestore.collection().stream.return_value = [mock_u1, mock_u2]
    
    headers = {"Authorization": f"Bearer {sign_test_token(uid='admin-uid', role='admin')}"}
    
    # CASE 1: Default (include_deleted=False)
    response = client.get("/users/", headers=headers)
    assert len(response.json()) == 1
    
    # CASE 2: include_deleted=True
    response = client.get("/users/?include_deleted=True", headers=headers)
    assert len(response.json()) == 2
    assert response.json() == snapshot
