import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import os
from httpx import Response
import respx

# We need to mock the firestore client BEFORE importing app from main
# The global mock_db is used for tests that don't explicitly patch main.db
with patch("google.cloud.firestore.Client") as mock_db_global:
    from main import app

client = TestClient(app)

@pytest.fixture
def mock_profile_data():
    return {
        "user_id": "user-123",
        "display_name": "Gimli",
        "tagline": "A dwarf of the mountain",
        "bio": "I like axes.",
        "character_class": "Warrior",
        "realm": "Moria",
        "talents": ["Mining", "Axe Mastery"],
        "attributes": {
            "strength": 18,
            "dexterity": 10,
            "constitution": 16,
            "intelligence": 8,
            "wisdom": 12,
            "charisma": 8
        }
    }

@pytest.fixture
def mock_auth_service():
    with respx.mock as respx_mock:
        # Mock the internal auth service call
        auth_url = os.getenv("AUTH_SERVICE_URL", "http://auth:8001")
        respx_mock.post(f"{auth_url}/auth/verify").mock(
            return_value=Response(200, json={"uid": "test-user-123", "role": "user"})
        )
        yield respx_mock

# Fixture to provide a patched main.db for tests that need it
@pytest.fixture
def mock_firestore():
    with patch("main.db") as mock_db_fixture:
        yield mock_db_fixture

def test_health():
    response = client.get("/profiles/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_create_profile(mock_firestore, mock_auth_service):
    # Mock firestore doc
    mock_doc = MagicMock()
    mock_doc.id = "new-profile-id"
    mock_doc.to_dict.return_value = {
        "user_id": "test-user-123",
        "display_name": "Valerius the Bold",
        "tagline": "A noble knight",
        "bio": "Bio content",
        "character_class": "Paladin",
        "realm": "Aethelgard",
        "talents": ["Smite", "Lay on Hands"],
        "attributes": {"strength": 18, "dexterity": 12, "intelligence": 10, "wisdom": 14, "charisma": 16},
    }
    mock_doc.exists = True

    # Mock db.collection().document().set() and get()
    mock_firestore.collection.return_value.document.return_value.get.return_value = mock_doc
    mock_firestore.collection.return_value.document.return_value.set.return_value = None # Mock set operation

    payload = {
        "display_name": "Valerius the Bold",
        "character_class": "Paladin",
        "attributes": {"strength": 18, "charisma": 16, "spark": 12}
    }

    headers = {"Authorization": "Bearer fake-token"}
    response = client.post("/profiles/", json=payload, headers=headers)

    assert response.status_code == 201
    assert response.json()["display_name"] == "Valerius the Bold"
    assert response.json()["user_id"] == "test-user-123"
    assert response.json()["profile_id"] == "new-profile-id" # Ensure profile_id is returned

@patch("main.db")
def test_get_profile_success(mock_db, mock_profile_data, mock_auth_service):
    mock_doc = MagicMock()
    mock_doc.id = "test-id"
    mock_doc.to_dict.return_value = mock_profile_data
    mock_doc.exists = True

    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc

    headers = {"Authorization": "Bearer fake-token"}
    response = client.get("/profiles/test-id", headers=headers)
    assert response.status_code == 200
    assert response.json()["display_name"] == "Gimli"

@patch("main.db")
def test_get_profile_not_found(mock_db, mock_auth_service):
    mock_doc = MagicMock()
    mock_doc.exists = False
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    
    headers = {"Authorization": "Bearer fake-token"}
    response = client.get("/profiles/missing", headers=headers)
    assert response.status_code == 404

@patch("google.cloud.storage.Client")
@patch("main.db")
def test_upload_image(mock_db, mock_storage, mock_profile_data, mock_auth_service):
    with patch("main.GCS_BUCKET", "test-bucket"):
        # Mock Profile existence
        mock_doc = MagicMock()
        mock_doc.id = "test-id"
        mock_doc.exists = True
        mock_doc.to_dict.return_value = {**mock_profile_data, "user_id": "test-user-123", "image_urls": ["http://gcs.com/img.png"]}
        mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
        
        # Mock Storage
        mock_blob = MagicMock()
        mock_blob.public_url = "http://gcs.com/img.png"
        mock_storage.return_value.bucket.return_value.blob.return_value = mock_blob
        
        file_content = b"fake-image-data"
        headers = {"Authorization": "Bearer fake-token"}
        response = client.post(
            "/profiles/test-id/image",
            files={"file": ("test.png", file_content, "image/png")},
            headers=headers
        )
        
        assert response.status_code == 200
        assert "http://gcs.com/img.png" in response.json()["image_urls"]


def test_create_profile_validation_error_string_length(mock_firestore, mock_auth_service):
    # Mock auth response to bypass dependency
    headers = {"Authorization": "Bearer fake-token"}
    
    # Payload with a very long string (over 15KB)
    long_string = "A" * 16000
    payload = {
        "display_name": "Too Long",
        "bio": long_string,
        "attributes": {"strength": 10, "charisma": 10, "spark": 10}
    }
    
    response = client.post("/profiles/", json=payload, headers=headers)
    assert response.status_code == 400
    assert "is too long" in response.json()["detail"]


def test_create_profile_validation_error_array_length(mock_firestore, mock_auth_service):
    headers = {"Authorization": "Bearer fake-token"}
    
    # Payload with too many talents (over 100)
    many_talents = ["talent"] * 101
    payload = {
        "display_name": "Too Many Talents",
        "talents": many_talents,
        "attributes": {"strength": 10, "charisma": 10, "spark": 10}
    }
    
    response = client.post("/profiles/", json=payload, headers=headers)
    assert response.status_code == 400
    assert "is too large" in response.json()["detail"]
