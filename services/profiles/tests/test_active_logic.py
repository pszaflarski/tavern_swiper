import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import os
import jwt
import datetime

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

# We need to mock the firestore client BEFORE importing app from main
with patch("google.cloud.firestore.Client"):
    from main import app

client = TestClient(app)

@pytest.fixture
def mock_firestore():
    with patch("main.db") as mock_db_fixture:
        yield mock_db_fixture

def test_create_profile_enforces_active(mock_firestore):
    """Verify that creating a profile forces is_active=True and deactivates others."""
    uid = "test-user-123"
    token = sign_test_token(uid=uid)
    
    # Mocking docs
    mock_new_doc = MagicMock()
    mock_new_doc.id = "new-id"
    mock_new_doc.to_dict.return_value = {"user_id": uid, "display_name": "New Hero", "is_active": True}
    mock_new_doc.exists = True
    
    # Mock existing active profile
    mock_old_doc = MagicMock()
    mock_old_doc.id = "old-id"
    mock_old_doc.reference.update = MagicMock()
    
    # Setup mocks
    mock_firestore.collection.return_value.where.return_value.where.return_value.stream.return_value = [mock_old_doc]
    mock_firestore.collection.return_value.document.return_value.get.return_value = mock_new_doc
    
    payload = {"display_name": "New Hero"}
    header = {"Authorization": f"Bearer {token}"}
    
    response = client.post("/profiles/", json=payload, headers=header)
    
    assert response.status_code == 201
    assert response.json()["is_active"] is True
    
    # Verify deactivation called for old profile
    mock_old_doc.reference.update.assert_called_with({"is_active": False})
    
    # Verify set was called with is_active=True even if omitted in payload
    mock_set = mock_firestore.collection.return_value.document.return_value.set
    args, _ = mock_set.call_args
    assert args[0]["is_active"] is True

def test_set_active_endpoint(mock_firestore):
    """Verify the /set_active endpoint sets profile to active and deactivates others."""
    uid = "test-user-123"
    token = sign_test_token(uid=uid)
    profile_id = "target-profile-id"
    
    # Mock target profile
    mock_target_doc = MagicMock()
    mock_target_doc.id = "target-profile-id"
    mock_target_doc.exists = True
    mock_target_doc.to_dict.return_value = {"user_id": uid, "display_name": "Target", "is_active": False}
    
    # Mock other active profile
    mock_other_doc = MagicMock()
    mock_other_doc.id = "other-id"
    mock_other_doc.reference.update = MagicMock()
    
    # Setup mocks
    mock_firestore.collection.return_value.document.return_value.get.side_effect = [mock_target_doc, mock_target_doc]
    mock_firestore.collection.return_value.where.return_value.where.return_value.stream.return_value = [mock_other_doc]
    
    header = {"Authorization": f"Bearer {token}"}
    response = client.post(f"/profiles/{profile_id}/set_active", headers=header)
    
    assert response.status_code == 200
    
    # Verify target was updated to active
    mock_firestore.collection.return_value.document.return_value.update.assert_called_with({"is_active": True})
    
    # Verify other was deactivated
    mock_other_doc.reference.update.assert_called_with({"is_active": False})

def test_set_active_unauthorized(mock_firestore):
    """Verify setting active fails if the profile belongs to someone else."""
    uid = "attacker-uid"
    token = sign_test_token(uid=uid)
    profile_id = "victim-profile-id"
    
    # Mock profile belonging to someone else
    mock_target_doc = MagicMock()
    mock_target_doc.exists = True
    mock_target_doc.to_dict.return_value = {"user_id": "victim-uid", "display_name": "Victim"}
    
    mock_firestore.collection.return_value.document.return_value.get.return_value = mock_target_doc
    
    header = {"Authorization": f"Bearer {token}"}
    response = client.post(f"/profiles/{profile_id}/set_active", headers=header)
    
    assert response.status_code == 403
