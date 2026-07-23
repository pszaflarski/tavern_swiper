"""Native Firestore client for vector search on the router-{env} database."""

import os
import logging
from google.cloud import firestore

logger = logging.getLogger(__name__)

_client: firestore.Client | None = None


def get_firestore_client() -> firestore.Client:
    """Return a singleton native Firestore client for the router database."""
    global _client
    if _client is not None:
        return _client

    env = os.getenv("ENV", "dev")
    database_id = os.getenv("FIRESTORE_DATABASE_ID", f"agent-router-{env}")

    _client = firestore.Client(database=database_id)
    logger.info("Initialized native Firestore client for database '%s'", database_id)
    return _client
