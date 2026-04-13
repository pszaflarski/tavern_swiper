import os
import sys
import time
from google.cloud import pubsub_v1
from datetime import datetime, timezone

# Add profiles/generated to path
sys.path.append(os.path.join(os.getcwd(), "services/profiles/generated"))
import profile_events_pb2

PROJECT_ID = "tavern-swiper-dev"
TOPICS = {
    "dev": "dev-profiles-profile-events-v1",
    "test": "test-profiles-profile-events-v1"
}
SUBSCRIPTIONS = {
    "dev": "dev-discovery-from-profiles-profile-events-v1-sub",
    "test": "test-discovery-from-profiles-profile-events-v1-sub"
}

def create_resources():
    publisher = pubsub_v1.PublisherClient()
    subscriber = pubsub_v1.SubscriberClient()
    
    for env, topic_id in TOPICS.items():
        topic_path = publisher.topic_path(PROJECT_ID, topic_id)
        try:
            publisher.create_topic(name=topic_path)
            print(f"✅ Created topic: {topic_id}")
        except Exception as e:
            if "AlreadyExists" in str(e):
                print(f"ℹ️ Topic {topic_id} already exists.")
            else:
                print(f"❌ Error creating topic {topic_id}: {e}")

        sub_id = SUBSCRIPTIONS[env]
        sub_path = subscriber.subscription_path(PROJECT_ID, sub_id)
        try:
            subscriber.create_subscription(name=sub_path, topic=topic_path)
            print(f"✅ Created subscription: {sub_id}")
        except Exception as e:
            if "AlreadyExists" in str(e):
                print(f"ℹ️ Subscription {sub_id} already exists.")
            else:
                print(f"❌ Error creating subscription {sub_id}: {e}")

def publish_message(env, profile_id, display_name):
    publisher = pubsub_v1.PublisherClient()
    topic_path = publisher.topic_path(PROJECT_ID, TOPICS[env])
    
    event = profile_events_pb2.ProfileEvent()
    event.type = profile_events_pb2.ProfileEvent.UPSERTED
    
    upserted = event.upserted
    upserted.profile_id = profile_id
    upserted.user_id = f"user_{profile_id}"
    upserted.display_name = display_name
    upserted.is_active = True
    
    data = event.SerializeToString()
    future = publisher.publish(topic_path, data)
    print(f"📤 Published to {env}: {display_name} ({profile_id})")
    return future.result()

def pull_messages(env):
    subscriber = pubsub_v1.SubscriberClient()
    sub_path = subscriber.subscription_path(PROJECT_ID, SUBSCRIPTIONS[env])
    
    print(f"📥 Pulling from {env} ({SUBSCRIPTIONS[env]})...")
    response = subscriber.pull(
        request={"subscription": sub_path, "max_messages": 5},
        timeout=5.0
    )
    
    for received_message in response.received_messages:
        event = profile_events_pb2.ProfileEvent()
        event.ParseFromString(received_message.message.data)
        
        if event.type == profile_events_pb2.ProfileEvent.UPSERTED:
            p = event.upserted
            print(f"✨ Received on {env}: [{p.profile_id}] {p.display_name}")
        
        subscriber.acknowledge(
            request={"subscription": sub_path, "ack_ids": [received_message.ack_id]}
        )

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "setup":
        create_resources()
    else:
        print("🚀 Starting Pub/Sub Isolation Demo...")
        
        # 1. Publish to DEV
        publish_message("dev", "dev-123", "Dev Hero")
        
        # 2. Publish to TEST
        publish_message("test", "test-456", "Test Warrior")
        
        # 3. Wait for Pub/Sub to propagate
        time.sleep(3)
        
        # 4. Pull and Verify
        pull_messages("dev")
        pull_messages("test")
        
        print("\n🏁 Demo Complete.")
