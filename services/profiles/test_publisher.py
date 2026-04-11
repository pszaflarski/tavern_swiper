import unittest
from unittest.mock import MagicMock, patch
import os
import sys

# Setup paths
CURRENT_DIR = os.path.dirname(__file__)
sys.path.append(CURRENT_DIR)
sys.path.append(os.path.join(CURRENT_DIR, "generated"))

from pubsub_utils import Publisher
import profile_events_pb2

class TestPublisher(unittest.TestCase):
    @patch('google.cloud.pubsub_v1.PublisherClient')
    def setUp(self, mock_client):
        self.mock_client = mock_client
        self.publisher = Publisher()

    def test_publish_upserted(self):
        # Mock profile data
        profile_data = {
            "profile_id": "prof_123",
            "user_id": "user_456",
            "display_name": "Test User",
            "tagline": "Hello World",
            "is_active": True,
            "image_urls": ["http://image1.jpg", "http://image2.jpg"]
        }
        
        # We need to mock the publish method's return value (a future)
        mock_future = MagicMock()
        self.publisher.publisher.publish.return_value = mock_future
        
        self.publisher.publish_upserted(profile_data)
        
        # Verify publish was called
        self.publisher.publisher.publish.assert_called_once()
        
        # Verify call arguments
        args, kwargs = self.publisher.publisher.publish.call_args
        payload = args[1]
        
        # Deserialize and verify
        event = profile_events_pb2.ProfileEvent()
        event.ParseFromString(payload)
        
        self.assertEqual(event.type, profile_events_pb2.ProfileEvent.UPSERTED)
        self.assertEqual(event.upserted.profile_id, "prof_123")
        self.assertEqual(event.upserted.display_name, "Test User")
        self.assertEqual(event.upserted.tagline, "Hello World")
        self.assertEqual(len(event.upserted.image_urls), 2)
        self.assertTrue(event.upserted.is_active)

    def test_publish_deleted(self):
        mock_future = MagicMock()
        self.publisher.publisher.publish.return_value = mock_future
        
        self.publisher.publish_deleted("prof_123")
        
        args, kwargs = self.publisher.publisher.publish.call_args
        payload = args[1]
        
        event = profile_events_pb2.ProfileEvent()
        event.ParseFromString(payload)
        
        self.assertEqual(event.type, profile_events_pb2.ProfileEvent.DELETED)
        self.assertEqual(event.deleted.profile_id, "prof_123")

if __name__ == '__main__':
    unittest.main()
