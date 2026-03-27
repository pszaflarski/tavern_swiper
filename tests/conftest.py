import pytest
import os
from google.cloud import firestore

@pytest.fixture(scope="session", autouse=True)
def cleanup_test_databases():
    """Wipe the test Firestore databases before and after running the test suite."""
    project = "tavern-swiper-dev"
    databases = ["users-test", "profiles-test", "auth-test", "swipes-test", "messages-test", "discovery-test"]
    
    def wipe():
        print(f"\n🧹 Wiping test databases ({project})...")
        for db_id in databases:
            try:
                db = firestore.Client(project=project, database=db_id)
                collections = db.collections()
                for coll in collections:
                    _delete_collection(coll, 500)
                print(f"  ✅ {db_id} cleaned.")
            except Exception as e:
                print(f"  ⚠️ Could not clean {db_id}: {e}")

    wipe()  # Before session
    yield
    wipe()  # After session

def _delete_collection(coll_ref, batch_size):
    """Helper to delete a collection in batches."""
    docs = coll_ref.limit(batch_size).stream()
    deleted = 0

    for doc in docs:
        doc.reference.delete()
        deleted += 1

    if deleted >= batch_size:
        return _delete_collection(coll_ref, batch_size)
