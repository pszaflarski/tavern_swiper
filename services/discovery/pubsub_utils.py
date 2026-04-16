import os
import logging
import sys
from google.cloud import pubsub_v1
from datetime import datetime, timezone

# Add generated directory to path so we can import the generated modules
sys.path.append(os.path.join(os.path.dirname(__file__), "generated"))
import match_events_pb2

logger = logging.getLogger("discovery.pubsub")

class Publisher:
    def __init__(self):
        self.project_id = os.getenv("PUBSUB_PROJECT_ID", "tavern-swiper-dev")
        self.topic_id = os.getenv("PUBSUB_TOPIC_ID", "match-events")
        
        # Check for emulator
        self.emulator_host = os.getenv("PUBSUB_EMULATOR_HOST")
        if self.emulator_host:
            logger.info(f"Using Pub/Sub Emulator at {self.emulator_host}")
            os.environ["PUBSUB_EMULATOR_HOST"] = self.emulator_host
            
        try:
            self.publisher = pubsub_v1.PublisherClient()
            self.topic_path = self.publisher.topic_path(self.project_id, self.topic_id)
            logger.info(f"Pub/Sub Publisher initialized for topic: {self.topic_path}")
        except Exception as e:
            logger.error(f"Failed to initialize Pub/Sub Publisher: {e}")
            self.publisher = None

    def publish_match_created(self, match_id: str, profile_ids: list, created_at: any):
        """
        Publishes a MATCH_CREATED event.
        :param match_id: The unique ID of the match
        :param profile_ids: List of profile IDs involved in the match
        :param created_at: The timestamp of creation (datetime or iso string)
        """
        if not self.publisher:
            return

        try:
            event = match_events_pb2.MatchEvent()
            event.type = match_events_pb2.MatchEvent.CREATED
            
            created = event.created
            created.match_id = match_id
            created.profile_ids.extend(profile_ids)
            
            # Convert datetime to string if needed
            if isinstance(created_at, datetime):
                created.created_at = created_at.isoformat()
            else:
                created.created_at = str(created_at)
            
            self._publish(event)
        except Exception as e:
            logger.error(f"Failed to publish match created event: {e}")

    def publish_match_deleted(self, match_id: str):
        """
        Publishes a MATCH_DELETED event.
        :param match_id: The ID of the match that was deleted
        """
        if not self.publisher:
            return
            
        try:
            event = match_events_pb2.MatchEvent()
            event.type = match_events_pb2.MatchEvent.DELETED
            event.deleted.match_id = match_id
            self._publish(event)
        except Exception as e:
            logger.error(f"Failed to publish match deleted event: {e}")

    def _publish(self, event):
        if not self.publisher:
            return
            
        try:
            payload = event.SerializeToString()
            future = self.publisher.publish(self.topic_path, payload)
            # We wait for the result here for better reliability in the dev phase
            future.result() 
            logger.info(f"Published match event type {event.type} for match: {self.topic_path}")
        except Exception as e:
            logger.error(f"Error in Pub/Sub serialization/publishing: {e}")
