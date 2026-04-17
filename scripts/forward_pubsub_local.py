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
    from google.api_core import exceptions
    try:
        subscriber.create_subscription(request={"name": subscription_path, "topic": topic_path})
        print(f"✅ Created temporary subscription: {SUBSCRIPTION_ID}")
    except exceptions.AlreadyExists:
        print(f"ℹ️ Subscription {SUBSCRIPTION_ID} already exists. Using existing.")
    except Exception as e:
        print(f"❌ Error creating subscription: {e}")
        return

    def callback(message):
        print(f"📥 Received Pub/Sub message: {message.message_id}")
        
        # Construct a Structured CloudEvent payload
        import base64
        encoded_data = base64.b64encode(message.data).decode('utf-8')
        
        ce_payload = {
            "specversion": "1.0",
            "type": "google.cloud.pubsub.topic.v1.messagePublished",
            "source": f"//pubsub.googleapis.com/projects/{PROJECT_ID}/topics/{TOPIC_ID}",
            "id": message.message_id,
            "datacontenttype": "application/json",
            "data": {
                "message": {
                    "data": encoded_data
                }
            }
        }

        try:
            # Send using the specific 'application/cloudevents+json' content type
            resp = requests.post(
                LOCAL_URL, 
                json=ce_payload, 
                headers={"Content-Type": "application/cloudevents+json"}, 
                timeout=5
            )
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
