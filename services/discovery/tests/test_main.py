import pytest
import respx
from httpx import Response
from fastapi.testclient import TestClient
from unittest.mock import MagicMock
import os
import jwt
import datetime

# The app is imported after firestore is mocked in conftest.py
from main import app, SWIPES_COLLECTION, MATCHES_COLLECTION

JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-tavern-key-123")
JWT_ALGORITHM = "HS256"

def sign_test_token(uid="u1", role="user"):
    payload = {
        "sub": uid,
        "role": role,
        "iat": datetime.datetime.now(tz=datetime.timezone.utc),
        "exp": datetime.datetime.now(tz=datetime.timezone.utc) + datetime.timedelta(minutes=30)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

client = TestClient(app, raise_server_exceptions=False)

@pytest.fixture
def mock_auth_service():
    """Activates respx to mock cross-service calls."""
    with respx.mock as respx_mock:
        yield respx_mock

def test_health(snapshot):
    response = client.get("/discovery/health")
    assert response.status_code == 200
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_get_feed_success(mock_db, snapshot):
    # Mock Firestore for ownership check and profiles_profiles_cache
    mock_p1 = MagicMock(); mock_p1.exists = True
    mock_p1.to_dict.return_value = {"profile_id": "p1", "user_id": "u1", "display_name": "Aragorn", "is_active": True, "image_urls": []}
    
    mock_p2 = MagicMock(); mock_p2.exists = True
    mock_p2.to_dict.return_value = {"profile_id": "p2", "user_id": "u2", "display_name": "Legolas", "is_active": True, "image_urls": []}
    
    def collection_side_effect(name):
        m = MagicMock()
        if name == "profiles_profiles_cache":
            m.document.return_value.get.return_value = mock_p1
            m.where.return_value.limit.return_value.stream.return_value = [mock_p1, mock_p2]
        else:
            m.where.return_value.stream.return_value = []
        return m
    mock_db.collection.side_effect = collection_side_effect
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/discovery/feed/p1", headers=headers)
    
    assert response.status_code == 200
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_get_feed_with_filtering(mock_db, snapshot):
    mock_swipe_doc = MagicMock()
    mock_swipe_doc.to_dict.return_value = {"swiped_profile_id": "p2"}
    
    mock_p1 = MagicMock(); mock_p1.exists = True
    mock_p1.to_dict.return_value = {"profile_id": "p1", "user_id": "u1", "display_name": "Aragorn", "is_active": True, "image_urls": []}
    mock_p2 = MagicMock(); mock_p2.exists = True
    mock_p2.to_dict.return_value = {"profile_id": "p2", "user_id": "u2", "display_name": "Legolas", "is_active": True, "image_urls": []}
    mock_p3 = MagicMock(); mock_p3.exists = True
    mock_p3.to_dict.return_value = {"profile_id": "p3", "user_id": "u3", "display_name": "Gimli", "is_active": True, "image_urls": []}

    def collection_side_effect(name):
        m = MagicMock()
        if name == "profiles_profiles_cache":
            m.document.return_value.get.return_value = mock_p1
            m.where.return_value.limit.return_value.stream.return_value = [mock_p1, mock_p2, mock_p3]
        else:
            m.where.return_value.stream.return_value = [mock_swipe_doc]
        return m
    mock_db.collection.side_effect = collection_side_effect
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/discovery/feed/p1", headers=headers)
    
    assert response.status_code == 200
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_record_swipe_success(mock_db, snapshot):
    payload = {"swiper_profile_id": "p1", "swiped_profile_id": "p2", "direction": "right"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    mock_p1 = MagicMock(); mock_p1.exists = True; mock_p1.to_dict.return_value = {"user_id": "u1"}
    
    def collection_side_effect(name):
        m = MagicMock()
        if name == "profiles_profiles_cache":
            m.document.return_value.get.return_value = mock_p1
        return m
    mock_db.collection.side_effect = collection_side_effect

    response = client.post("/discovery/swipe/", json=payload, headers=headers)
    assert response.status_code == 201
    
    # We replace dynamic swipe_id for snapshot stability
    data = response.json()
    data["swipe_id"] = "fixed-swipe-id-for-snapshot"
    assert data == snapshot

@pytest.mark.asyncio
async def test_record_swipe_mutual_match(mock_db, mock_publisher, snapshot):
    payload = {"swiper_profile_id": "p1", "swiped_profile_id": "p2", "direction": "right"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    reciprocal_swipe = MagicMock()
    reciprocal_swipe.to_dict.return_value = {"swiper_profile_id": "p2", "swiped_profile_id": "p1", "direction": "right"}
    
    mock_p1 = MagicMock(); mock_p1.exists = True; mock_p1.to_dict.return_value = {"user_id": "u1"}
    
    def collection_side_effect(name):
        m = MagicMock()
        if name == "profiles_profiles_cache":
            m.document.return_value.get.return_value = mock_p1
        elif name == SWIPES_COLLECTION:
            m.where.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = [reciprocal_swipe]
        return m
    mock_db.collection.side_effect = collection_side_effect
    
    response = client.post("/discovery/swipe/", json=payload, headers=headers)
    assert response.status_code == 201
    
    data = response.json()
    data["swipe_id"] = "fixed-swipe-id-for-snapshot"
    assert data == snapshot
    
    # Verify publisher was called
    mock_publisher.publish_match_created.assert_called_once()

@pytest.mark.asyncio
async def test_get_match_success(mock_db, snapshot):
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    mock_doc = MagicMock(); mock_doc.exists = True
    now = datetime.datetime(2026, 4, 17, 12, 0, 0, tzinfo=datetime.timezone.utc)
    mock_doc.to_dict.return_value = {"id": "match_p1_p2", "profiles": ["p1", "p2"], "created_at": now}
    
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    
    response = client.get("/discovery/matches/match_p1_p2", headers=headers)
    assert response.status_code == 200
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_record_swipe_self(mock_db, snapshot):
    mock_p1 = MagicMock(); mock_p1.exists = True; mock_p1.to_dict.return_value = {"user_id": "u1"}
    mock_db.collection.return_value.document.return_value.get.return_value = mock_p1

    payload = {"swiper_profile_id": "p1", "swiped_profile_id": "p1", "direction": "right"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    response = client.post("/discovery/swipe/", json=payload, headers=headers)
    assert response.status_code == 400
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_get_feed_unauthorized_profile(mock_db, snapshot):
    mock_p1 = MagicMock(); mock_p1.exists = True; mock_p1.to_dict.return_value = {"user_id": "u2"}
    mock_db.collection.return_value.document.return_value.get.return_value = mock_p1
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/discovery/feed/p1", headers=headers)
    assert response.status_code == 403
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_get_feed_not_found(mock_db, snapshot):
    mock_p1 = MagicMock(); mock_p1.exists = False
    mock_db.collection.return_value.document.return_value.get.return_value = mock_p1
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/discovery/feed/p999", headers=headers)
    assert response.status_code == 404
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_auth_expired_token(snapshot):
    exp = datetime.datetime.now(tz=datetime.timezone.utc) - datetime.timedelta(minutes=10)
    payload = {"sub": "u1", "role": "user", "iat": exp, "exp": exp}
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/discovery/swipe/", json={}, headers=headers)
    assert response.status_code == 401
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_record_swipe_validation_error(snapshot):
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    # Missing swiped_profile_id
    payload = {"swiper_profile_id": "p1", "direction": "up"} 
    response = client.post("/discovery/swipe/", json=payload, headers=headers)
    assert response.status_code == 422
    assert response.json() == snapshot

@pytest.mark.asyncio
async def test_list_matches_for_profile_success(mock_db, snapshot):
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    mock_match = MagicMock()
    mock_match.to_dict.return_value = {
        "id": "match_p1_p2",
        "profiles": ["p1", "p2"],
        "created_at": datetime.datetime(2026, 4, 17, 12, 0, 0, tzinfo=datetime.timezone.utc)
    }
    mock_db.collection.return_value.where.return_value.stream.return_value = [mock_match]
    
    response = client.get("/discovery/matches/profile/p1", headers=headers)
    assert response.status_code == 200
    assert response.json() == snapshot

def test_discovery_profile_resilience_to_nulls():
    from models import DiscoveryProfile
    data = {
        "profile_id": "p_null",
        "display_name": "Ghost Hero",
        "image_urls": None,
        "talents": None,
        "is_active": True
    }
    profile = DiscoveryProfile(**data)
    assert profile.image_urls == []
    assert profile.talents == []
