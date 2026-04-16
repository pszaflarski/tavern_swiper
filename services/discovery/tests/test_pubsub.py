import pytest
from unittest.mock import patch, MagicMock
import os
import sys

# Add discovery directory to path for imports
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from pubsub_utils import Publisher
import match_events_pb2

@pytest.fixture
def mock_pubsub():
    with patch("google.cloud.pubsub_v1.PublisherClient") as mock_client:
        yield mock_client

def test_publish_match_created(mock_pubsub):
    # Setup
    publisher = Publisher()
    match_id = "match_1_2"
    profile_ids = ["profile1", "profile2"]
    created_at = "2026-04-16T12:00:00Z"

    # Execute
    publisher.publish_match_created(match_id, profile_ids, created_at)

    # Verify
    mock_pubsub().publish.assert_called_once()
    args, kwargs = mock_pubsub().publish.call_args
    
    # Verify the payload
    payload = args[1]
    event = match_events_pb2.MatchEvent()
    event.ParseFromString(payload)
    
    assert event.type == match_events_pb2.MatchEvent.CREATED
    assert event.created.match_id == match_id
    assert list(event.created.profile_ids) == profile_ids
    assert event.created.created_at == created_at

def test_publish_match_deleted(mock_pubsub):
    # Setup
    publisher = Publisher()
    match_id = "match_1_2"

    # Execute
    publisher.publish_match_deleted(match_id)

    # Verify
    mock_pubsub().publish.assert_called_once()
    args, kwargs = mock_pubsub().publish.call_args
    
    # Verify the payload
    payload = args[1]
    event = match_events_pb2.MatchEvent()
    event.ParseFromString(payload)
    
    assert event.type == match_events_pb2.MatchEvent.DELETED
    assert event.deleted.match_id == match_id

def test_publisher_handles_error(mock_pubsub):
    # Setup
    publisher = Publisher()
    # Mock publish to raise an exception
    mock_pubsub().publish.side_effect = Exception("Pub/Sub delivery failure")
    
    # Execute - should not raise exception
    with patch("pubsub_utils.logger.error") as mock_log:
        publisher.publish_match_created("id", ["p1", "p2"], "date")
        
        # Verify logger was called
        mock_log.assert_called()
