import pytest
from unittest.mock import MagicMock, patch
import os
import sys

# Add the service directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pubsub_utils import Publisher

@pytest.fixture
def mock_publisher_client():
    with patch("google.cloud.pubsub_v1.PublisherClient") as mock_client:
        # Mock the topic_path method
        mock_client.return_value.topic_path.return_value = "projects/test-project/topics/test-topic"
        yield mock_client

def test_publish_upserted(mock_publisher_client):
    # Initialize publisher
    pub = Publisher()
    
    # Define test data
    profile_data = {
        "profile_id": "prof-123",
        "user_id": "user-456",
        "display_name": "Test King",
        "tagline": "The first of his name",
        "image_urls": ["http://example.com/img1.jpg"]
    }
    
    # Act
    pub.publish_upserted(profile_data)
    
    # Assert
    # Check if publisher.publish was called
    mock_inst = mock_publisher_client.return_value
    assert mock_inst.publish.called
    
    # Check the call arguments
    args, kwargs = mock_inst.publish.call_args
    topic_path = args[0]
    payload = args[1]
    
    assert topic_path == "projects/test-project/topics/test-topic"
    assert len(payload) > 0
    
    # Optionally: deserialize payload to verify contents
    import profile_events_pb2
    event = profile_events_pb2.ProfileEvent()
    event.ParseFromString(payload)
    
    assert event.type == profile_events_pb2.ProfileEvent.UPSERTED
    assert event.upserted.profile_id == "prof-123"
    assert event.upserted.display_name == "Test King"

def test_publish_deleted(mock_publisher_client):
    pub = Publisher()
    pub.publish_deleted("prof-789")
    
    mock_inst = mock_publisher_client.return_value
    args, kwargs = mock_inst.publish.call_args
    payload = args[1]
    
    import profile_events_pb2
    event = profile_events_pb2.ProfileEvent()
    event.ParseFromString(payload)
    
    assert event.type == profile_events_pb2.ProfileEvent.DELETED
    assert event.deleted.profile_id == "prof-789"
