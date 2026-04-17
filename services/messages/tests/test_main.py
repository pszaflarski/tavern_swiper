import pytest
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
    # Rely on patched datetime.utcnow() for deterministic tokens
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

def test_health(snapshot):
    response = client.get("/messages/health")
    assert response.status_code == 200
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_auth_expired_token(snapshot):
    exp = datetime.datetime.utcnow() - datetime.timedelta(minutes=10)
    token = jwt.encode({"sub": "u1", "role": "user", "iat": exp, "exp": exp}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"match_id": "m1", "sender_profile_id": "p1", "content": "Late!"}
    response = client.post("/messages/", json=payload, headers=headers)
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_auth_invalid_signature(snapshot):
    token = jwt.encode({"sub": "u1", "role": "user"}, "WRONG_SECRET", algorithm=JWT_ALGORITHM)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"match_id": "m1", "sender_profile_id": "p1", "content": "Fake!"}
    response = client.post("/messages/", json=payload, headers=headers)
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_send_message_validation_error(snapshot):
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    # Missing content
    payload = {"match_id": "m1", "sender_profile_id": "p1"}
    response = client.post("/messages/", json=payload, headers=headers)
    assert response.status_code == 422
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_send_message_success(mock_db, mock_auth_service, snapshot):
    # Mock Discovery match participants
    mock_auth_service.get(f"{os.getenv('DISCOVERY_SERVICE_URL', 'http://discovery:8003')}/discovery/matches/m1").mock(
        return_value=Response(200, json={"profiles": ["p1", "p2"]})
    )
    
    payload = {"match_id": "m1", "sender_profile_id": "p1", "content": "Hail!"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/messages/", json=payload, headers=headers)
    assert response.status_code == 201
    
    data = response.json()
    data["message_id"] = "fixed-message-id-for-snapshot"
    assert data == snapshot

@pytest.mark.asyncio
async def test_send_message_current_behavior_no_verification(mock_auth_service, snapshot):
    mock_auth_service.get(f"{os.getenv('DISCOVERY_SERVICE_URL', 'http://discovery:8003')}/discovery/matches/any_match").mock(
        return_value=Response(200, json={"profiles": ["p2", "p3"]})
    )
    payload = {"match_id": "any_match", "sender_profile_id": "p2", "content": "Hack!"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/messages/", json=payload, headers=headers)
    
    data = response.json()
    data["message_id"] = "fixed-message-id-for-snapshot"
    assert data == snapshot

@pytest.mark.asyncio
async def test_send_message_unauthorized_match(mock_auth_service, snapshot):
    mock_auth_service.get(f"{os.getenv('DISCOVERY_SERVICE_URL', 'http://discovery:8003')}/discovery/matches/not_my_match").mock(
        return_value=Response(200, json={"profiles": ["p3", "p4"]})
    )
    headers = {"Authorization": f"Bearer {sign_test_token(uid='u2')}"}
    payload = {"match_id": "not_my_match", "sender_profile_id": "p1", "content": "Spying!"}
    response = client.post("/messages/", json=payload, headers=headers)
    
    data = response.json()
    data["message_id"] = "fixed-message-id-for-snapshot"
    assert data == snapshot

@pytest.mark.asyncio
async def test_send_message_discovery_failure_resilience(mock_db, mock_auth_service, snapshot):
    mock_auth_service.get(f"{os.getenv('DISCOVERY_SERVICE_URL', 'http://discovery:8003')}/discovery/matches/m1").mock(return_value=Response(500))
    
    payload = {"match_id": "m1", "sender_profile_id": "p1", "content": "Still sending!"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/messages/", json=payload, headers=headers)
    
    data = response.json()
    data["message_id"] = "fixed-message-id-for-snapshot"
    assert data == snapshot

@pytest.mark.asyncio
async def test_get_messages_success(mock_db, snapshot):
    now = datetime.datetime.now(tz=datetime.timezone.utc)
    mock_msg_1 = MagicMock(); mock_msg_1.id = "msg1"; mock_msg_1.to_dict.return_value = {"match_id": "m1", "sender_profile_id": "p1", "content": "Hi", "sent_at": now}
    mock_msg_2 = MagicMock(); mock_msg_2.id = "msg2"; mock_msg_2.to_dict.return_value = {"match_id": "m1", "sender_profile_id": "p2", "content": "Hello", "sent_at": now}
    
    mock_db.collection.return_value.where.return_value.stream.return_value = [mock_msg_1, mock_msg_2]
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/messages/m1", headers=headers)
    assert response.status_code == 200
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_list_conversations_success(mock_db, mock_auth_service, snapshot):
    now = datetime.datetime.now(tz=datetime.timezone.utc)
    
    # Mock Discovery returning all matches for this profile
    matches_response = [
        {"id": "match_p1_p2", "profiles": ["p1", "p2"], "created_at": "2026-04-17T12:00:00Z"},
        {"id": "match_p1_p3", "profiles": ["p1", "p3"], "created_at": "2026-04-17T12:00:00Z"}
    ]
    mock_auth_service.get(f"{os.getenv('DISCOVERY_SERVICE_URL', 'http://discovery:8003')}/discovery/matches/profile/p1").mock(
        return_value=Response(200, json=matches_response)
    )
    
    # Mock Firestore returning messages for participant p1
    mock_msg = MagicMock(); mock_msg.id = "msg1"
    mock_msg.to_dict.return_value = {"match_id": "match_p1_p2", "sender_profile_id": "p1", "content": "Hi to p2", "sent_at": now, "participant_profile_ids": ["p1", "p2"]}
    mock_db.collection.return_value.where.return_value.stream.return_value = [mock_msg]
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/messages/conversations/p1", headers=headers)
    assert response.status_code == 200
    assert response.json() == snapshot

def test_delete_all_messages_admin_success(mock_db):
    # This endpoint returns 204 No Content, so we don't snapshot test the body.
    # We will just verify it returns correctly, as it doesn't return JSON to snapshot.
    headers = {"Authorization": f"Bearer {sign_test_token(role='admin')}"}
    mock_doc = MagicMock(); mock_doc.reference = MagicMock()
    mock_db.collection.return_value.limit.return_value.stream.side_effect = [[mock_doc], []]
    
    response = client.delete("/messages/", headers=headers)
    assert response.status_code == 204
