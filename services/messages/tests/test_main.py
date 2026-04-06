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
