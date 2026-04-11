import os
import sys
import logging
from google.cloud import pubsub_v1

# Add profiles directory and generated directory to path
PROFILES_DIR = os.path.join(os.getcwd(), "services", "profiles")
sys.path.append(PROFILES_DIR)
sys.path.append(os.path.join(PROFILES_DIR, "generated"))

try:
    import profile_events_pb2
except ImportError:
    print("Error: Could not import generated profile_events_pb2. Make sure you ran generate_proto.sh")
    sys.exit(1)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verification")

def callback(message):
    try:
        event = profile_events_pb2.ProfileEvent()
        event.ParseFromString(message.data)
        
        print("-" * 40)
        print(f"Received Event: {profile_events_pb2.ProfileEvent.EventType.Name(event.type)}")
        
        if event.type == profile_events_pb2.ProfileEvent.UPSERTED:
            p = event.upserted
            print(f"  Profile ID: {p.profile_id}")
            print(f"  User ID:    {p.user_id}")
            print(f"  Display Name: {p.display_name}")
            print(f"  Tagline:    {p.tagline}")
            print(f"  Is Active:  {p.is_active}")
        elif event.type == profile_events_pb2.ProfileEvent.DELETED:
            print(f"  Profile ID: {event.deleted.profile_id}")
        elif event.type == profile_events_pb2.ProfileEvent.ALL_DELETED:
            print(f"  Admin:     {event.all_deleted.admin_user_id}")
            print(f"  Timestamp: {event.all_deleted.timestamp}")
        
        message.ack()
    except Exception as e:
        logger.error(f"Error processing message: {e}")
        message.nack()

def main():
    project_id = os.getenv("PUBSUB_PROJECT_ID", "tavern-swiper-dev")
    subscription_id = os.getenv("PUBSUB_SUBSCRIPTION_ID", "profile-updates-sub")
    
    # Honor existing env, but don't force it to localhost if not found
    emulator_host = os.getenv("PUBSUB_EMULATOR_HOST")
    
    print(f"Listening for events on {project_id}/{subscription_id}...")
    if emulator_host:
        print(f"PUBSUB_EMULATOR_HOST: {emulator_host}")
    else:
        print("Connecting to live Google Cloud Pub/Sub...")

    subscriber = pubsub_v1.SubscriberClient()
    subscription_path = subscriber.subscription_path(project_id, subscription_id)

    streaming_pull_future = subscriber.subscribe(subscription_path, callback=callback)
    
    with subscriber:
        try:
            streaming_pull_future.result(timeout=60)
        except Exception as e:
            streaming_pull_future.cancel()
            streaming_pull_future.result()

if __name__ == "__main__":
    main()
