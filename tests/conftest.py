import pytest
import os
from google.cloud import firestore

@pytest.fixture(scope="session", autouse=True)
def cleanup_test_databases():
    """Placeholder for test DB cleanup. Enable wipe logic when needed."""
    yield

def pytest_addoption(parser):
    parser.addoption("--real-auth", action="store_true", help="Use real Firebase Auth instead of dev-mint")

def pytest_configure(config):
    if config.getoption("--real-auth"):
        os.environ["USE_REAL_FIREBASE_AUTH"] = "true"

def _delete_collection(coll_ref, batch_size):
    """Helper to delete a collection in batches."""
    docs = coll_ref.limit(batch_size).stream()
    deleted = 0

    for doc in docs:
        doc.reference.delete()
        deleted += 1

    if deleted >= batch_size:
        return _delete_collection(coll_ref, batch_size)
