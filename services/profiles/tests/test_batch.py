import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from main import app
import jwt
import datetime
import os

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

client = TestClient(app, raise_server_exceptions=False)

@pytest.fixture
def mock_firestore():
    with patch("main.db") as mock_db_fixture:
        yield mock_db_fixture

def test_batch_success(mock_firestore):
    """Verify that multiple IDs are fetched and mapped correctly."""
    mock_doc1 = MagicMock()
    mock_doc1.id = "p1"
    mock_doc1.to_dict.return_value = {"user_id": "u1", "display_name": "Aura", "is_active": True}
    
    mock_doc2 = MagicMock()
    mock_doc2.id = "p2"
    mock_doc2.to_dict.return_value = {"user_id": "u2", "display_name": "Boros", "is_active": False}
    
    # query chain: db.collection().where().stream()
    mock_firestore.collection.return_value.where.return_value.stream.return_value = [mock_doc1, mock_doc2]
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/profiles/batch", json={"profile_ids": ["p1", "p2"]}, headers=headers)
    
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert data[0]["profile_id"] == "p1"
    assert data[1]["display_name"] == "Boros"

def test_batch_chunking(mock_firestore):
    """Verify that more than 30 IDs triggers multiple Firestore calls (chunking)."""
    # Create 35 IDs
    ids = [f"p{i}" for i in range(35)]
    
    # Mock stream to return 1 doc per call roughly
    mock_firestore.collection.return_value.where.return_value.stream.side_effect = [[MagicMock()], [MagicMock()]]
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/profiles/batch", json={"profile_ids": ids}, headers=headers)
    
    assert response.status_code == 200
    # The where() should have been called twice (once for first 30, once for last 5)
    assert mock_firestore.collection.return_value.where.call_count == 2

def test_batch_invalid_ids_filter(mock_firestore):
    """Verify that empty/null IDs are filtered out before querying Firestore."""
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    # These IDs should be ignored by the logic while remaining technically valid strings for Pydantic
    response = client.post("/profiles/batch", json={"profile_ids": ["", "  "]}, headers=headers)
    
    assert response.status_code == 200
    assert response.json() == []
    # Firestore shouldn't even be called
    assert mock_firestore.collection.call_count == 0

def test_batch_malformed_document_resilience(mock_firestore):
    """Verify that a malformed document doesn't crash the whole batch request."""
    mock_valid = MagicMock()
    mock_valid.id = "valid-1"
    mock_valid.to_dict.return_value = {"user_id": "u1", "display_name": "Valid Hero"}
    
    mock_malformed = MagicMock()
    mock_malformed.id = "broken-1"
    # missing display_name and user_id entirely
    mock_malformed.to_dict.return_value = {}
    
    mock_firestore.collection.return_value.where.return_value.stream.return_value = [mock_valid, mock_malformed]
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/profiles/batch", json={"profile_ids": ["valid-1", "broken-1"]}, headers=headers)
    
    assert response.status_code == 200
    data = response.json()
    # Should only contain the valid one
    assert len(data) == 1
    assert data[0]["profile_id"] == "valid-1"

def test_global_exception_handler_cors(mock_firestore):
    """Verify that a crash still returns CORS headers."""
    # Force a crash by making the collection call raise an exception
    mock_firestore.collection.side_effect = Exception("Database is on fire!")
    
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    response = client.post("/profiles/batch", json={"profile_ids": ["p1"]}, headers=headers)
    
    assert response.status_code == 500
    assert response.json()["type"] == "unhandled_exception"
    # CRITICAL CHECK: CORS header must be present even on crash
    assert response.headers.get("Access-Control-Allow-Origin") == "*"

def test_validation_exception_handler_cors():
    """Verify that pydantic validation errors return CORS headers."""
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    # Send incorrect body (profile_ids should be list, not string)
    response = client.post("/profiles/batch", json={"profile_ids": "not-a-list"}, headers=headers)
    
    assert response.status_code == 422
    assert response.headers.get("Access-Control-Allow-Origin") == "*"
