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
    from main import app, PROFILES_SERVICE_URL, SWIPES_COLLECTION

client = TestClient(app, raise_server_exceptions=False)

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
    # Mock Firestore for ownership check and profiles_profiles_cache
    with patch("main.db.collection") as mock_coll:
        # Mock swiped check (empty)
        # Mock cache stream (returns p1, p2, p3)
        mock_p1 = MagicMock(); mock_p1.to_dict.return_value = {"profile_id": "p1", "user_id": "u1", "display_name": "Aragorn", "is_active": True, "image_urls": []}; mock_p1.exists = True
        mock_p2 = MagicMock(); mock_p2.to_dict.return_value = {"profile_id": "p2", "user_id": "u2", "display_name": "Legolas", "is_active": True, "image_urls": []}; mock_p2.exists = True
        mock_p3 = MagicMock(); mock_p3.to_dict.return_value = {"profile_id": "p3", "user_id": "u3", "display_name": "Gimli", "is_active": True, "image_urls": []}; mock_p3.exists = True
        
        # We need to distinguish between 'swipes' and 'profiles_profiles_cache' collections
        def collection_side_effect(name):
            m = MagicMock()
            if name == "profiles_profiles_cache":
                # Mock .document(id).get() for ownership check
                m.document.return_value.get.return_value = mock_p1
                # Mock .where(...).limit(...).stream() for candidate hydration
                m.where.return_value.where.return_value.limit.return_value.stream.return_value = [mock_p1, mock_p2, mock_p3]
                # Handle single where for get_feed's limit search
                m.where.return_value.limit.return_value.stream.return_value = [mock_p1, mock_p2, mock_p3]
            else:
                m.where.return_value.stream.return_value = []
            return m
            
        mock_coll.side_effect = collection_side_effect
        
        headers = {"Authorization": f"Bearer {sign_test_token()}"}
        response = client.get("/discovery/feed/p1", headers=headers)
        
        assert response.status_code == 200
        profiles = response.json()["profiles"]
        # Expecting p2 and p3 (p1 excluded because it's the requester)
        assert len(profiles) == 2

@pytest.mark.asyncio
async def test_get_feed_with_filtering(mock_auth_service, mock_profiles):
    # Mock Firestore for both 'swipes' and 'profiles_profiles_cache'
    with patch("main.db.collection") as mock_coll:
        # Mock swiped p2
        mock_swipe_doc = MagicMock()
        mock_swipe_doc.to_dict.return_value = {"swiped_profile_id": "p2"}
        
        # Mock cache docs
        mock_p1 = MagicMock(); mock_p1.to_dict.return_value = {"profile_id": "p1", "user_id": "u1", "display_name": "Aragorn", "is_active": True, "image_urls": []}; mock_p1.exists = True
        mock_p2 = MagicMock(); mock_p2.to_dict.return_value = {"profile_id": "p2", "user_id": "u2", "display_name": "Legolas", "is_active": True, "image_urls": []}; mock_p2.exists = True
        mock_p3 = MagicMock(); mock_p3.to_dict.return_value = {"profile_id": "p3", "user_id": "u3", "display_name": "Gimli", "is_active": True, "image_urls": []}; mock_p3.exists = True

        def collection_side_effect(name):
            m = MagicMock()
            if name == "profiles_profiles_cache":
                m.document.return_value.get.return_value = mock_p1
                m.where.return_value.limit.return_value.stream.return_value = [mock_p1, mock_p2, mock_p3]
            else:
                m.where.return_value.stream.return_value = [mock_swipe_doc]
            return m
            
        mock_coll.side_effect = collection_side_effect
        
        headers = {"Authorization": f"Bearer {sign_test_token()}"}
        response = client.get("/discovery/feed/p1", headers=headers)
        
        assert response.status_code == 200
        profiles = response.json()["profiles"]
        # Only p3 should be left (p1 is self, p2 swiped)
        assert len(profiles) == 1
        assert profiles[0]["profile_id"] == "p3"

@pytest.mark.asyncio
async def test_record_swipe_success(mock_auth_service):
    payload = {
        "swiper_profile_id": "p1",
        "swiped_profile_id": "p2",
        "direction": "right"
    }
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    # Mock Firestore for recording the swipe and ownership check
    with patch("main.db.collection") as mock_coll:
        mock_p1 = MagicMock()
        mock_p1.exists = True
        mock_p1.to_dict.return_value = {"user_id": "u1"}
        
        def collection_side_effect(name):
            m = MagicMock()
            if name == "profiles_profiles_cache":
                m.document.return_value.get.return_value = mock_p1
            return m
        mock_coll.side_effect = collection_side_effect

        response = client.post("/discovery/swipe/", json=payload, headers=headers)
        assert response.status_code == 201
        data = response.json()
        assert data["direction"] == "right"
        assert "swipe_id" in data
        
        # Verify firestore.set was called correctly (via mock chain)
        # Note: the mock_coll.return_value for 'swipes' will be the default mock
        # which will have its document().set() called.

@pytest.mark.asyncio
async def test_get_feed_unauthorized_profile(mock_auth_service):
    # Mock Firestore: p1 belongs to u2
    with patch("main.db.collection") as mock_coll:
        mock_p1 = MagicMock()
        mock_p1.exists = True
        mock_p1.to_dict.return_value = {"user_id": "u2"}
        mock_coll.return_value.document.return_value.get.return_value = mock_p1
        
        headers = {"Authorization": f"Bearer {sign_test_token()}"}
        response = client.get("/discovery/feed/p1", headers=headers)
        assert response.status_code == 403

def test_health():
    response = client.get("/discovery/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

@pytest.mark.asyncio
async def test_record_swipe_mutual_match(mock_auth_service):
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
    # 4. Ownership check for p1
    reciprocal_swipe = MagicMock()
    reciprocal_swipe.to_dict.return_value = {
        "swiper_profile_id": "p2",
        "swiped_profile_id": "p1",
        "direction": "right"
    }
    
    mock_p1 = MagicMock()
    mock_p1.exists = True
    mock_p1.to_dict.return_value = {"user_id": "u1"}
    
    with patch("main.db.collection") as mock_coll:
        def collection_side_effect(name):
            m = MagicMock()
            if name == "profiles_profiles_cache":
                m.document.return_value.get.return_value = mock_p1
            elif name == SWIPES_COLLECTION:
                # Chain for reciprocal check: db.collection(SWI).where(...).where(...).where(...).limit(1).stream()
                m.where.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = [reciprocal_swipe]
            return m
        mock_coll.side_effect = collection_side_effect
        
        response = client.post("/discovery/swipe/", json=payload, headers=headers)
        assert response.status_code == 201
        data = response.json()
        assert data["id"] == "match_p1_p2"

@pytest.mark.asyncio
async def test_get_match_success():
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    # Mock Firestore
    mock_doc = MagicMock()
    mock_doc.exists = True
    now = datetime.datetime.now(tz=datetime.timezone.utc)
    mock_doc.to_dict.return_value = {
        "id": "match_p1_p2",
        "profiles": ["p1", "p2"],
        "created_at": now
    }
    
    with patch("main.db.collection") as mock_coll:
        mock_coll.return_value.document.return_value.get.return_value = mock_doc
        
        response = client.get("/discovery/matches/match_p1_p2", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "match_p1_p2"
        assert data["profiles"] == ["p1", "p2"]

@pytest.mark.asyncio
async def test_record_swipe_self(mock_auth_service):
    # Mock Firestore ownership check
    with patch("main.db.collection") as mock_coll:
        mock_p1 = MagicMock()
        mock_p1.exists = True
        mock_p1.to_dict.return_value = {"user_id": "u1"}
        mock_coll.return_value.document.return_value.get.return_value = mock_p1

        payload = {"swiper_profile_id": "p1", "swiped_profile_id": "p1", "direction": "right"}
        headers = {"Authorization": f"Bearer {sign_test_token()}"}
        
        response = client.post("/discovery/swipe/", json=payload, headers=headers)
        assert response.status_code == 400
        assert "own profile" in response.json()["detail"]

@pytest.mark.asyncio
async def test_get_feed_cache_failure(mock_auth_service):
    # Mock Firestore returning empty/non-existent swiper profile
    with patch("main.db.collection") as mock_coll:
        mock_p1 = MagicMock()
        mock_p1.exists = False
        mock_coll.return_value.document.return_value.get.return_value = mock_p1
        
        headers = {"Authorization": f"Bearer {sign_test_token()}"}
        response = client.get("/discovery/feed/p1", headers=headers)
        assert response.status_code == 404

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

@pytest.mark.asyncio
async def test_list_matches_for_profile_query_building():
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    with patch("main.db.collection") as mock_coll:
        # Mock the stream to return an empty list
        mock_coll.return_value.where.return_value.stream.return_value = []
        
        response = client.get("/discovery/matches/profile/p1", headers=headers)
        
        assert response.status_code == 200
        # Verify that the where clause was called with the correct operator
        mock_coll.return_value.where.assert_called_once_with("profiles", "array_contains", "p1")

@pytest.mark.asyncio
async def test_get_feed_swipe_history_failure_resilience(mock_auth_service):
    # Mock Firestore: p1 belongs to u1, but swipes query FAILS
    with patch("main.db.collection") as mock_coll:
        mock_p1 = MagicMock(); mock_p1.exists = True; mock_p1.to_dict.return_value = {"profile_id": "p1", "user_id": "u1", "display_name": "Aragorn", "is_active": True, "image_urls": []}
        
        def side_effect(name):
            m = MagicMock()
            if name == "profiles_profiles_cache":
                m.document.return_value.get.return_value = mock_p1
                m.where.return_value.limit.return_value.stream.return_value = [mock_p1]
            else:
                m.where.return_value.stream.side_effect = Exception("Firestore Query Failed")
            return m
        mock_coll.side_effect = side_effect
        
        headers = {"Authorization": f"Bearer {sign_test_token()}"}
        response = client.get("/discovery/feed/p1", headers=headers)
        
        # Should still succeed (returns empty list or unfiltered candidates depending on logic)
        # In main.py, it returns an empty set for already_swiped on failure and continues.
        assert response.status_code == 200

@pytest.mark.asyncio
async def test_record_swipe_match_creation_failure(mock_auth_service):
    payload = {"swiper_profile_id": "p1", "swiped_profile_id": "p2", "direction": "right"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    with patch("main.db.collection") as mock_coll:
        mock_p1 = MagicMock(); mock_p1.exists = True; mock_p1.to_dict.return_value = {"user_id": "u1"}
        reciprocal_swipe = MagicMock(); reciprocal_swipe.to_dict.return_value = {"direction": "right"}
        
        def side_effect(name):
            m = MagicMock()
            if name == "profiles_profiles_cache":
                m.document.return_value.get.return_value = mock_p1
            elif name == SWIPES_COLLECTION:
                m.where.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = [reciprocal_swipe]
            elif name == "matches":
                # Mock match creation FAILURE
                m.document.return_value.set.side_effect = Exception("Match Creation Failed")
            return m
        mock_coll.side_effect = side_effect
        
        response = client.post("/discovery/swipe/", json=payload, headers=headers)
        # In current main.py, it doesn't try-except the match creation, so it should 500
        assert response.status_code == 500

def test_discovery_profile_resilience_to_nulls():
    """Verify that DiscoveryProfile coerces None/null fields to empty lists."""
    from models import DiscoveryProfile
    
    data = {
        "profile_id": "p_null",
        "display_name": "Ghost Hero",
        "image_urls": None,   # This caused the 500 crash previously
        "talents": None,
        "is_active": True
    }
    
    profile = DiscoveryProfile(**data)
    assert profile.image_urls == []
    assert profile.talents == []
    assert profile.profile_id == "p_null"
