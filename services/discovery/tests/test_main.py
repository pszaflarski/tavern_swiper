import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import os
import jwt
import datetime

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
# Mock firestore before importing app
with patch("google.cloud.firestore.Client"):
    from main import app, PROFILES_SERVICE_URL

client = TestClient(app)

@pytest.fixture
def mock_profiles():
    return [
        {"profile_id": "p1", "display_name": "Aragorn", "is_active": True, "image_urls": []},
        {"profile_id": "p2", "display_name": "Legolas", "is_active": True, "image_urls": []},
        {"profile_id": "p3", "display_name": "Gimli", "is_active": True, "image_urls": []},
    ]

@pytest.fixture
def mock_auth_service():
    """Activates respx to mock cross-service calls."""
    with respx.mock as respx_mock:
        yield respx_mock

@pytest.mark.asyncio
async def test_get_feed_success(mock_auth_service, mock_profiles):
    respx_mock = mock_auth_service
    
    # Mock Profiles Service (ownership check for p1)
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(
        return_value=Response(200, json={"user_id": "u1"})
    )
    
    # Mock Profiles Service: returns all profiles via discovery endpoint
    respx_mock.get(url__startswith=f"{PROFILES_SERVICE_URL}/profiles/discovery").mock(
        return_value=Response(200, json=mock_profiles)
    )
    
    # Firestore is mocked to return empty stream by default via the 'patch' above.
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/discovery/feed/p1", headers=headers)
    
    assert response.status_code == 200
    profiles = response.json()["profiles"]
    # Expecting p2 and p3 (p1 excluded because it's the requester)
    assert len(profiles) == 2

@pytest.mark.asyncio
async def test_get_feed_with_filtering(mock_auth_service, mock_profiles):
    respx_mock = mock_auth_service
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(return_value=Response(200, json={"user_id": "u1"}))
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/discovery?limit=20").mock(return_value=Response(200, json=mock_profiles))
    
    # Mock Firestore to say p2 was already swiped
    mock_doc = MagicMock()
    mock_doc.to_dict.return_value = {"swiped_profile_id": "p2"}
    
    # We need to reach into main.db and mock the query chain.
    # This is a bit advanced, but let's try a direct patch for the filtering logic:
    with patch("main.db.collection") as mock_coll:
        mock_coll.return_value.where.return_value.stream.return_value = [mock_doc]
        
        headers = {"Authorization": f"Bearer {sign_test_token()}"}
        response = client.get("/discovery/feed/p1", headers=headers)
        
        assert response.status_code == 200
        profiles = response.json()["profiles"]
        # Only p3 should be left (p1 is self, p2 swiped)
        assert len(profiles) == 1
        assert profiles[0]["profile_id"] == "p3"

@pytest.mark.asyncio
async def test_record_swipe_success(mock_auth_service):
    respx_mock = mock_auth_service
    # Mock Profiles (ownership check)
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(
        return_value=Response(200, json={"user_id": "u1"})
    )
    
    payload = {
        "swiper_profile_id": "p1",
        "swiped_profile_id": "p2",
        "direction": "right"
    }
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    # Mock Firestore for recording the swipe
    with patch("main.db.collection") as mock_coll:
        response = client.post("/discovery/swipe/", json=payload, headers=headers)
        assert response.status_code == 201
        data = response.json()
        assert data["direction"] == "right"
        assert "swipe_id" in data
        
        # Verify firestore.set was called correctly (via mock chain)
        mock_coll.return_value.document.return_value.set.assert_called_once()

@pytest.mark.asyncio
async def test_get_feed_unauthorized_profile(mock_auth_service):
    respx_mock = mock_auth_service
    # Mock Profiles Service: p1 belongs to u2
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(
        return_value=Response(200, json={"user_id": "u2"})
    )
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/discovery/feed/p1", headers=headers)
    assert response.status_code == 403

def test_health():
    response = client.get("/discovery/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

@pytest.mark.asyncio
async def test_record_swipe_mutual_match(mock_auth_service):
    respx_mock = mock_auth_service
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(
        return_value=Response(200, json={"user_id": "u1"})
    )
    
    payload = {
        "swiper_profile_id": "p1",
        "swiped_profile_id": "p2",
        "direction": "right"
    }
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    # Mock Firestore for:
    # 1. Recording the swipe
    # 2. Searching for reciprocal swipe (should return p2->p1 right swipe)
    # 3. Recording the match
    reciprocal_swipe = MagicMock()
    reciprocal_swipe.to_dict.return_value = {
        "swiper_profile_id": "p2",
        "swiped_profile_id": "p1",
        "direction": "right"
    }
    
    with patch("main.db.collection") as mock_coll:
        # Chain for reciprocal check: db.collection(SWI).where(...).where(...).where(...).limit(1).stream()
        mock_coll.return_value.where.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = [reciprocal_swipe]
        
        response = client.post("/discovery/swipe/", json=payload, headers=headers)
        assert response.status_code == 201
        data = response.json()
        assert data["match_id"] == "match_p1_p2"
        
        # Verify firestore.set was called twice (once for swipe, once for match)
        assert mock_coll.return_value.document.return_value.set.call_count == 2

@pytest.mark.asyncio
async def test_get_match_success():
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    # Mock Firestore
    mock_doc = MagicMock()
    mock_doc.exists = True
    now = datetime.datetime.now(tz=datetime.timezone.utc)
    mock_doc.to_dict.return_value = {
        "match_id": "match_p1_p2",
        "profiles": ["p1", "p2"],
        "created_at": now
    }
    
    with patch("main.db.collection") as mock_coll:
        mock_coll.return_value.document.return_value.get.return_value = mock_doc
        
        response = client.get("/discovery/matches/match_p1_p2", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["match_id"] == "match_p1_p2"
        assert data["profiles"] == ["p1", "p2"]

@pytest.mark.asyncio
async def test_record_swipe_self(mock_auth_service):
    respx_mock = mock_auth_service
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(return_value=Response(200, json={"user_id": "u1"}))
    
    payload = {"swiper_profile_id": "p1", "swiped_profile_id": "p1", "direction": "right"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    response = client.post("/discovery/swipe/", json=payload, headers=headers)
    assert response.status_code == 400
    assert "own profile" in response.json()["detail"]

@pytest.mark.asyncio
async def test_get_feed_service_failure(mock_auth_service):
    respx_mock = mock_auth_service
    # Mock Profiles service returning 500
    respx_mock.get(f"{PROFILES_SERVICE_URL}/profiles/p1").mock(return_value=Response(500))
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/discovery/feed/p1", headers=headers)
    assert response.status_code == 502

@pytest.mark.asyncio
async def test_auth_expired_token():
    # Sign a token that expired 10 minutes ago
    exp = datetime.datetime.utcnow() - datetime.timedelta(minutes=10)
    payload = {"sub": "u1", "role": "user", "iat": exp, "exp": exp}
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    headers = {"Authorization": f"Bearer {token}"}
    response = client.get("/discovery/health", headers=headers) # Use health or any endpoint that uses auth
    # Note: /discovery/health currently DOES NOT use get_current_user in the actual code 
    # but the task.md says "Add Security Tests ... to each service's test_main.py where applicable"
    # Actually, discovery/main.py:104 record_swipe uses auth_data.
    response = client.post("/discovery/swipe/", json={}, headers=headers)
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_auth_invalid_signature():
    # Sign with WRONG secret
    token = jwt.encode({"sub": "u1", "role": "user"}, "WRONG_SECRET", algorithm=JWT_ALGORITHM)
    
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/discovery/swipe/", json={}, headers=headers)
    assert response.status_code == 401
