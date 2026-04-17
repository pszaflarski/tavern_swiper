import pytest
import os
import sys
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone
from freezegun import freeze_time

# Add the service directory to sys.path
service_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if service_dir not in sys.path:
    sys.path.insert(0, service_dir)

# Mock firestore.Client BEFORE importing any service code
# This ensures that 'db = firestore.Client()' in main.py gets a mock
from google.cloud import firestore
mock_firestore_patcher = patch("google.cloud.firestore.Client")
mock_firestore_patcher.start()

@pytest.fixture(autouse=True)
def mock_firestore_client():
    """Globally mock Firestore Client to prevent real network calls."""
    return mock_firestore_patcher

@pytest.fixture(autouse=True)
def mock_db_reset():
    """Ensure main.db mocks are reset between tests."""
    from main import db
    db.reset_mock()
    # Also reset the side_effect which is not cleared by reset_mock()
    db.collection.side_effect = None
    db.collection.return_value.document.return_value.get.side_effect = None
    return db

@pytest.fixture
def mock_db():
    from main import db
    return db

@pytest.fixture(autouse=True)
def stable_now():
    """Freeze time for deterministic snapshots."""
    with freeze_time("2026-04-17 12:00:00Z"):
        yield

@pytest.fixture(autouse=True)
def mock_publisher(mocker):
    """Mock the Pub/Sub publisher to avoid network calls."""
    return mocker.patch("main.publisher")
