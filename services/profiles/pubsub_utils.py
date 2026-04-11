import os
import logging
from google.cloud import pubsub_v1
from datetime import datetime, timezone
import sys

# Add generated directory to path so we can import the generated modules
sys.path.append(os.path.join(os.path.dirname(__file__), "generated"))
import profile_events_pb2

logger = logging.getLogger("profiles.pubsub")

class Publisher:
    def __init__(self):
        self.project_id = os.getenv("PUBSUB_PROJECT_ID", "tavern-swiper-dev")
        self.topic_id = os.getenv("PUBSUB_TOPIC_ID", "profile-updates")
        
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

    def publish_upserted(self, profile):
        """
        Publishes a PROFILE_UPSERTED event.
        :param profile: dict or ProfileOut model
        """
        if not self.publisher:
            return

        try:
            # Handle both dict and Pydantic model
            if hasattr(profile, "model_dump"):
                data = profile.model_dump()
            elif hasattr(profile, "dict"): # For older Pydantic versions
                data = profile.dict()
            else:
                data = profile

            event = profile_events_pb2.ProfileEvent()
            event.type = profile_events_pb2.ProfileEvent.UPSERTED
            
            # Use data.get() to avoid KeyErrors
            upserted = event.upserted
            upserted.profile_id = str(data.get("profile_id", ""))
            upserted.user_id = str(data.get("user_id", ""))
            upserted.display_name = str(data.get("display_name", ""))
            
            if data.get("tagline"):
                upserted.tagline = data["tagline"]
            if data.get("bio"):
                upserted.bio = data["bio"]
            if data.get("image_urls"):
                upserted.image_urls.extend(data["image_urls"])
            if data.get("gender"):
                upserted.gender = data["gender"]
            
            upserted.is_active = bool(data.get("is_active", False))
            
            self._publish(event)
        except Exception as e:
            logger.error(f"Failed to publish upserted event: {e}")

    def publish_deleted(self, profile_id):
        if not self.publisher:
            return
            
        try:
            event = profile_events_pb2.ProfileEvent()
            event.type = profile_events_pb2.ProfileEvent.DELETED
            event.deleted.profile_id = profile_id
            self._publish(event)
        except Exception as e:
            logger.error(f"Failed to publish deleted event: {e}")

    def publish_all_deleted(self, admin_user_id):
        if not self.publisher:
            return
            
        try:
            event = profile_events_pb2.ProfileEvent()
            event.type = profile_events_pb2.ProfileEvent.ALL_DELETED
            event.all_deleted.admin_user_id = admin_user_id
            event.all_deleted.timestamp = datetime.now(timezone.utc).isoformat()
            self._publish(event)
        except Exception as e:
            logger.error(f"Failed to publish all_deleted event: {e}")

    def _publish(self, event):
        if not self.publisher:
            return
            
        payload = event.SerializeToString()
        future = self.publisher.publish(self.topic_path, payload)
        # We don't block by default in the API thread, but for simplicity and 
        # reliability in this task, we can wait for confirmation.
        future.result() 
        logger.info(f"Published event {event.type} to {self.topic_path}")
