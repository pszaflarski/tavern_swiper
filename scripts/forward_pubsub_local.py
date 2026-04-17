import time
import requests
import json
from google.cloud import pubsub_v1

# --- Configuration ---
PROJECT_ID = "tavern-swiper-dev"
TOPIC_ID = "dev-profiles-profile-events-v1"
SUBSCRIPTION_ID = "local-bridge-sub" # We will create this
LOCAL_URL = "http://localhost:8080"

def setup_bridge():
    subscriber = pubsub_v1.SubscriberClient()
    topic_path = subscriber.topic_path(PROJECT_ID, TOPIC_ID)
    subscription_path = subscriber.subscription_path(PROJECT_ID, SUBSCRIPTION_ID)

    # 1. Ensure temporary subscription exists
    try:
        subscriber.create_subscription(request={"name": subscription_path, "topic": topic_path})
        print(f"✅ Created temporary subscription: {SUBSCRIPTION_ID}")
    except Exception as e:
        if "AlreadyExists" in str(e):
            print(f"ℹ️ Subscription {SUBSCRIPTION_ID} already exists.")
        else:
            print(f"❌ Error creating subscription: {e}")
            return

    def callback(message):
        print(f"📥 Received Pub/Sub message: {message.message_id}")
        
        # Construct the CloudEvent-like JSON structure that HandleProfileEvent expects
        # (Flat format based on my analysis of the Go code)
        payload = {
            "data": list(message.data) # Convert bytes to list/unquoted for JSON serialization? No, just raw bytes as base64 or similar.
            # Actually, json.dumps on bytes usually fails, let's see how Go unmarshals it.
        }
        
        # Based on HandleProfileEvent line 59, it expects: {"message": {"data": "..."}}
        import base64
        encoded_data = base64.b64encode(message.data).decode('utf-8')
        event_data = {
            "message": {
                "data": encoded_data
            }
        }

        try:
            resp = requests.post(LOCAL_URL, json=event_data, timeout=5)
            print(f"  🚀 Forwarded to LOCAL. Response: {resp.status_code}")
            message.ack()
        except Exception as e:
            print(f"  ❌ Failed to forward: {e}")

    print(f"🛰️ Bridge ACTIVE. Listening on {TOPIC_ID}...")
    streaming_pull_future = subscriber.subscribe(subscription_path, callback=callback)

    try:
        streaming_pull_future.result()
    except KeyboardInterrupt:
        streaming_pull_future.cancel()
        print("\n🛑 Bridge stopped.")

if __name__ == "__main__":
    setup_bridge()
