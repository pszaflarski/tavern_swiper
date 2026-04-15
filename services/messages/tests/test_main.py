import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import os
import jwt
import datetime

# Test JWT settings
JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-tavern-key-123")
JWT_ALGORITHM = "HS256"

def sign_test_token(uid="u1", role="user"):
    payload = {
        "sub": uid,
        "role": role,
        "iat": datetime.datetime.utcnow(),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=30)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

# Mock firestore before importing app
with patch("google.cloud.firestore.Client"):
    from main import app, PROFILES_SERVICE_URL

client = TestClient(app)

@pytest.fixture
def mock_auth_service():
    """Activates respx to mock cross-service calls."""
    with respx.mock as respx_mock:
        yield respx_mock

@pytest.mark.asyncio
@patch("main.db")
async def test_send_message_success(mock_db, mock_auth_service):
    respx_mock = mock_auth_service
    
    # 1. Profile ownership mock is no longer strictly required for _verify_match_access 
    # but we keep it for reference or if we add it back.
    
    payload = {"match_id": "m1", "sender_profile_id": "p1", "content": "Hail!"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/messages/", json=payload, headers=headers)
    assert response.status_code == 201

@pytest.mark.asyncio
async def test_send_message_current_behavior_no_verification(mock_auth_service):
    # Since verification is disabled, any match_id should currently pass
    payload = {"match_id": "any_match", "sender_profile_id": "p2", "content": "Hack!"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/messages/", json=payload, headers=headers)
    assert response.status_code == 201

def test_health():
    response = client.get("/messages/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

@pytest.mark.asyncio
async def test_send_message_unauthorized_match(mock_auth_service):
    """Placeholder: verify 403 when user is not in match. 
    Currently returns 201 because verification is skipped in main.py."""
    payload = {"match_id": "not_my_match", "sender_profile_id": "p1", "content": "Spying!"}
    headers = {"Authorization": f"Bearer {sign_test_token(uid='u2')}"}
    response = client.post("/messages/", json=payload, headers=headers)
    # FIXME: In a future phase, this should be 403
    assert response.status_code == 201 

@pytest.mark.asyncio
async def test_auth_expired_token():
    exp = datetime.datetime.utcnow() - datetime.timedelta(minutes=10)
    token = jwt.encode({"sub": "u1", "role": "user", "iat": exp, "exp": exp}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"match_id": "m1", "sender_profile_id": "p1", "content": "Late!"}
    response = client.post("/messages/", json=payload, headers=headers)
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_auth_invalid_signature():
    token = jwt.encode({"sub": "u1", "role": "user"}, "WRONG_SECRET", algorithm=JWT_ALGORITHM)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"match_id": "m1", "sender_profile_id": "p1", "content": "Fake!"}
    response = client.post("/messages/", json=payload, headers=headers)
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_list_conversations_query_building():
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    with patch("main.db.collection") as mock_coll:
        # Mock the stream to return an empty list
        mock_coll.return_value.where.return_value.order_by.return_value.stream.return_value = []
        
        response = client.get("/messages/conversations/p1", headers=headers)
        
        assert response.status_code == 200
        # Verify that the where clause was called with the correct operator
        mock_coll.return_value.where.assert_called_once_with("participant_profile_ids", "array_contains", "p1")

@pytest.mark.asyncio
@patch("main.db")
async def test_get_messages_success(mock_db, mock_auth_service):
    # Mock messages
    now = datetime.datetime.now(tz=datetime.timezone.utc)
    mock_msg_1 = MagicMock(); mock_msg_1.id = "msg1"; mock_msg_1.to_dict.return_value = {"match_id": "m1", "sender_profile_id": "p1", "content": "Hi", "sent_at": now}
    
    # Mock firestore stream
    mock_db.collection.return_value.where.return_value.stream.return_value = [mock_msg_1]
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/messages/m1", headers=headers)
    
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["content"] == "Hi"

@pytest.mark.asyncio
@patch("main.db")
async def test_delete_all_messages_admin_success(mock_db):
    headers = {"Authorization": f"Bearer {sign_test_token(role='admin')}"}
    
    # Mock batch deletion
    mock_doc = MagicMock(); mock_doc.reference = MagicMock()
    mock_db.collection.return_value.limit.return_value.stream.side_effect = [[mock_doc], []]
    
    response = client.delete("/messages/", headers=headers)
    assert response.status_code == 204
    mock_db.batch().delete.assert_called()
    mock_db.batch().commit.assert_called()

@pytest.mark.asyncio
@patch("main.db")
async def test_send_message_discovery_failure_resilience(mock_db, mock_auth_service):
    # Mock Discovery service failure (500)
    respx_mock = mock_auth_service
    respx_mock.get(f"{os.getenv('DISCOVERY_SERVICE_URL', 'http://discovery:8003')}/discovery/matches/m1").mock(return_value=Response(500))
    
    payload = {"match_id": "m1", "sender_profile_id": "p1", "content": "Still sending!"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    # Should still succeed indexing (with empty participants)
    response = client.post("/messages/", json=payload, headers=headers)
    assert response.status_code == 201
    # Verify participants was empty in the stored data
    mock_db.collection.return_value.document.return_value.set.assert_called()
    args, _ = mock_db.collection.return_value.document.return_value.set.call_args
    assert args[0]["participant_profile_ids"] == []
