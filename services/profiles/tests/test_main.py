import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import os
from httpx import Response
import respx
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
    """No longer mocks network, just provides a standard fixture signature if needed."""
    yield None

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

    headers = {"Authorization": f"Bearer {sign_test_token()}"}
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

    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/profiles/test-id", headers=headers)
    assert response.status_code == 200
    assert response.json()["display_name"] == "Gimli"

@patch("main.db")
def test_get_profile_not_found(mock_db, mock_auth_service):
    mock_doc = MagicMock()
    mock_doc.exists = False
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
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
        
        # Create a valid 1080x1350 JPEG
        from PIL import Image
        import io
        img = Image.new('RGB', (1080, 1350), color='green')
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        file_content = buf.getvalue()

        headers = {"Authorization": f"Bearer {sign_test_token()}"}
        response = client.post(
            "/profiles/test-id/image",
            files={"file": ("test.jpg", file_content, "image/jpeg")},
            headers=headers
        )
        
        assert response.status_code == 200
        assert "http://gcs.com/img.png" in response.json()["image_urls"]


def test_create_profile_validation_error_string_length(mock_firestore, mock_auth_service):
    # Mock auth response to bypass dependency
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    # Payload with a very long string (over 15KB)
    long_string = "A" * 16000
    payload = {
        "display_name": "Too Long",
        "bio": long_string
    }
    
    response = client.post("/profiles/", json=payload, headers=headers)
    assert response.status_code == 400
    assert "is too long" in response.json()["detail"]


def test_create_profile_validation_error_array_length(mock_firestore, mock_auth_service):
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    # Payload with too many image_urls (over 100)
    many_images = ["http://img.com/a.png"] * 101
    payload = {
        "display_name": "Too Many Images",
        "image_urls": many_images
    }
    
    response = client.post("/profiles/", json=payload, headers=headers)
    assert response.status_code == 400
    assert "is too large" in response.json()["detail"]


def test_list_all_profiles_admin_only(mock_firestore):
    # Test standard user (should be 403)
    standard_token = sign_test_token(uid="standard-user", role="user")
    headers = {"Authorization": f"Bearer {standard_token}"}
    response = client.get("/profiles/all", headers=headers)
    assert response.status_code == 403
    assert "Admin or Root Admin authorization required" in response.json()["detail"]

    # Test admin user (should be 200)
    admin_token = sign_test_token(uid="admin-user", role="admin")
    headers = {"Authorization": f"Bearer {admin_token}"}
    mock_firestore.collection.return_value.stream.return_value = []
    response = client.get("/profiles/all", headers=headers)
    assert response.status_code == 200


def test_list_profiles_for_user_public(mock_firestore, mock_profile_data):
    # Any logged in user should be able to see profiles for another user
    caller_token = sign_test_token(uid="another-user", role="user")
    headers = {"Authorization": f"Bearer {caller_token}"}
    
    mock_doc = MagicMock()
    mock_doc.id = "p1"
    mock_doc.to_dict.return_value = mock_profile_data
    mock_firestore.collection.return_value.where.return_value.stream.return_value = [mock_doc]
    
    response = client.get("/profiles/user/someone-else", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["display_name"] == "Gimli"


def test_get_my_active_profile(mock_firestore, mock_profile_data):
    # Mock firestore doc
    mock_doc = MagicMock()
    mock_doc.id = "active-p1"
    mock_doc.to_dict.return_value = {**mock_profile_data, "user_id": "test-user-123", "is_active": True}
    
    # Mock query chain: db.collection().where().where().limit().stream()
    mock_firestore.collection.return_value.where.return_value.where.return_value.limit.return_value.stream.return_value = [mock_doc]
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.get("/profiles/user/me/active", headers=headers)
    
    assert response.status_code == 200
    assert response.json()["profile_id"] == "active-p1"
    assert response.json()["is_active"] is True

@pytest.mark.asyncio
async def test_auth_expired_token():
    exp = datetime.datetime.utcnow() - datetime.timedelta(minutes=10)
    token = jwt.encode({"sub": "u1", "role": "user", "iat": exp, "exp": exp}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    headers = {"Authorization": f"Bearer {token}"}
    response = client.get("/profiles/health", headers=headers)
    # Health endpoint doesn't use auth, use something else
    response = client.get("/profiles/p1", headers=headers)
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_auth_invalid_signature():
    token = jwt.encode({"sub": "u1", "role": "user"}, "WRONG_SECRET", algorithm=JWT_ALGORITHM)
    headers = {"Authorization": f"Bearer {token}"}
    response = client.get("/profiles/p1", headers=headers)
    assert response.status_code == 401

@patch("google.cloud.storage.Client")
@patch("main.db")
def test_upload_image_magic_byte_failure(mock_db, mock_storage, mock_profile_data):
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    # Mock Profile existence
    mock_doc = MagicMock()
    mock_doc.id = "test-id"
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {**mock_profile_data, "user_id": "test-user-123"}
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    
    # Send non-JPEG file content
    response = client.post(
        "/profiles/test-id/image",
        files={"file": ("test.jpg", b"NOT-A-JPEG", "image/jpeg")},
        headers=headers
    )
    assert response.status_code == 400
    assert "Forbidden Essence" in response.json()["detail"]

@patch("google.cloud.storage.Client")
@patch("main.db")
def test_upload_image_dimension_failure_regular_user(mock_db, mock_storage, mock_profile_data):
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    mock_doc = MagicMock()
    mock_doc.id = "p1"; mock_doc.exists = True
    mock_doc.to_dict.return_value = {**mock_profile_data, "user_id": "test-user-123"}
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc

    # Create a small valid JPEG (but wrong dimensions: 100x100)
    from PIL import Image
    import io
    img = Image.new('RGB', (100, 100), color='red')
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    file_content = buf.getvalue()

    response = client.post(
        "/profiles/p1/image",
        files={"file": ("test.jpg", file_content, "image/jpeg")},
        headers=headers
    )
    assert response.status_code == 400
    assert "Imperfect Geometry" in response.json()["detail"]

@patch("google.cloud.storage.Client")
@patch("main.db")
def test_upload_image_admin_autocorrect_too_wide(mock_db, mock_storage, mock_profile_data):
    headers = {"Authorization": f"Bearer {sign_test_token(role='admin')}"}
    mock_doc = MagicMock(); mock_doc.id = "p1"; mock_doc.exists = True
    mock_doc.to_dict.return_value = {**mock_profile_data, "user_id": "test-user-123", "image_urls": []}
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    mock_blob = MagicMock()
    mock_blob.public_url = "http://gcs.com/wide.jpg"
    mock_storage.return_value.bucket.return_value.blob.return_value = mock_blob

    # 4000x1000: Ultra wide, requires heavy horizontal center-cropping
    from PIL import Image
    import io
    img = Image.new('RGB', (4000, 1000), color='cyan')
    buf = io.BytesIO(); img.save(buf, format="JPEG"); file_content = buf.getvalue()

    response = client.post("/profiles/p1/image", files={"file": ("wide.jpg", file_content, "image/jpeg")}, headers=headers)
    assert response.status_code == 200
    processed_bytes = mock_blob.upload_from_string.call_args[0][0]
    processed_img = Image.open(io.BytesIO(processed_bytes))
    assert processed_img.size == (1080, 1350)

@patch("google.cloud.storage.Client")
@patch("main.db")
def test_upload_image_admin_autocorrect_too_tall(mock_db, mock_storage, mock_profile_data):
    headers = {"Authorization": f"Bearer {sign_test_token(role='admin')}"}
    mock_doc = MagicMock(); mock_doc.id = "p1"; mock_doc.exists = True
    mock_doc.to_dict.return_value = {**mock_profile_data, "user_id": "test-user-123", "image_urls": []}
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    mock_blob = MagicMock()
    mock_blob.public_url = "http://gcs.com/tall.jpg"
    mock_storage.return_value.bucket.return_value.blob.return_value = mock_blob

    # 1000x4000: Ultra tall, requires vertical center-cropping
    from PIL import Image
    import io
    img = Image.new('RGB', (1000, 4000), color='magenta')
    buf = io.BytesIO(); img.save(buf, format="JPEG"); file_content = buf.getvalue()

    response = client.post("/profiles/p1/image", files={"file": ("tall.jpg", file_content, "image/jpeg")}, headers=headers)
    assert response.status_code == 200
    processed_bytes = mock_blob.upload_from_string.call_args[0][0]
    processed_img = Image.open(io.BytesIO(processed_bytes))
    assert processed_img.size == (1080, 1350)

@patch("google.cloud.storage.Client")
@patch("main.db")
def test_upload_image_admin_upscale_too_small(mock_db, mock_storage, mock_profile_data):
    headers = {"Authorization": f"Bearer {sign_test_token(role='admin')}"}
    mock_doc = MagicMock(); mock_doc.id = "p1"; mock_doc.exists = True
    mock_doc.to_dict.return_value = {**mock_profile_data, "user_id": "test-user-123", "image_urls": []}
    mock_db.collection.return_value.document.return_value.get.return_value = mock_doc
    mock_blob = MagicMock()
    mock_blob.public_url = "http://gcs.com/small.jpg"
    mock_storage.return_value.bucket.return_value.blob.return_value = mock_blob

    # 100x125: Correct ratio (4:5) but tiny (requires 10x upscaling)
    from PIL import Image
    import io
    img = Image.new('RGB', (100, 125), color='yellow')
    buf = io.BytesIO(); img.save(buf, format="JPEG"); file_content = buf.getvalue()

    response = client.post("/profiles/p1/image", files={"file": ("small.jpg", file_content, "image/jpeg")}, headers=headers)
    assert response.status_code == 200
    processed_bytes = mock_blob.upload_from_string.call_args[0][0]
    processed_img = Image.open(io.BytesIO(processed_bytes))
    assert processed_img.size == (1080, 1350)

def test_update_profile_success(mock_firestore, mock_profile_data):
    mock_doc = MagicMock()
    mock_doc.id = "test-id"
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {**mock_profile_data, "user_id": "test-user-123"}
    
    mock_firestore.collection.return_value.document.return_value.get.return_value = mock_doc
    
    payload = {"display_name": "Gimli Updated"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    with patch("main.publisher"):
        response = client.put("/profiles/test-id", json=payload, headers=headers)
    
    assert response.status_code == 200
    mock_firestore.collection.return_value.document.return_value.update.assert_called()

def test_update_profile_unauthorized(mock_firestore, mock_profile_data):
    mock_doc = MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {**mock_profile_data, "user_id": "other-user"}
    
    mock_firestore.collection.return_value.document.return_value.get.return_value = mock_doc
    
    payload = {"display_name": "Hacked"}
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    response = client.put("/profiles/test-id", json=payload, headers=headers)
    assert response.status_code == 403

def test_delete_profile_success(mock_firestore, mock_profile_data):
    mock_doc = MagicMock()
    mock_doc.exists = True
    mock_doc.to_dict.return_value = {**mock_profile_data, "user_id": "test-user-123"}
    
    mock_firestore.collection.return_value.document.return_value.get.return_value = mock_doc
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    
    with patch("main.publisher"):
        response = client.delete("/profiles/test-id", headers=headers)
    
    assert response.status_code == 204
    mock_firestore.collection.return_value.document.return_value.delete.assert_called()

@patch("google.cloud.storage.Client")
def test_delete_all_profiles_admin_success(mock_storage, mock_firestore):
    # Mock admin user
    headers = {"Authorization": f"Bearer {sign_test_token(role='admin')}"}
    
    # Mock Firestore batch deletion
    mock_doc = MagicMock(); mock_doc.id = "p1"; mock_doc.reference = MagicMock()
    # First call returns one doc, second call returns empty list to break the loop
    mock_firestore.collection.return_value.limit.return_value.stream.side_effect = [[mock_doc], []]
    
    # Mock GCS
    mock_bucket = mock_storage.return_value.bucket.return_value
    mock_blob = MagicMock()
    mock_bucket.list_blobs.return_value = [mock_blob]
    
    with patch("main.publisher"), patch("main.GCS_BUCKET", "test-bucket"):
        response = client.delete("/profiles/", headers=headers)
    
    assert response.status_code == 204
    mock_storage.return_value.bucket.return_value.delete_blobs.assert_called()
    mock_firestore.batch().delete.assert_called()
    mock_firestore.batch().commit.assert_called()


