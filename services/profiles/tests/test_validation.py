import pytest
from fastapi.testclient import TestClient
from main import app
from tests.test_main import sign_test_token

client = TestClient(app)

def test_validation_missing_fields(snapshot):
    """Capture the exact Pydantic error layout for missing required fields."""
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    # Empty payload for a POST request that requires fields
    response = client.post("/profiles/", json={}, headers=headers)
    assert response.status_code == 422
    assert response.json() == snapshot


def test_validation_invalid_types(snapshot):
    """Capture validation errors for wrong data types."""
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    payload = {
        "display_name": 12345,  # Should be string
        "is_active": "not-a-bool" # Should be bool
    }
    response = client.post("/profiles/", json=payload, headers=headers)
    assert response.status_code == 422
    assert response.json() == snapshot


def test_validation_batch_empty_list(snapshot):
    """Capture error when batch list is empty or invalid."""
    headers = {"Authorization": f"Bearer {sign_test_token()}"}
    payload = {"profile_ids": "not-a-list"}
    response = client.post("/profiles/batch", json=payload, headers=headers)
    assert response.status_code == 422
    assert response.json() == snapshot
