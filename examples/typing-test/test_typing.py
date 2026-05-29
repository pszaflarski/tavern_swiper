import jwt
import requests
import json
import time

# Configuration
JWT_SECRET = "super-secret-tavern-key-123"
MESSAGES_SERVICE_URL = "http://localhost:8005"
CONVERSATION_ID = "27012e5d-df26-43aa-92a6-37dbe171a5f9"
TYPING_PROFILE_ID = "31392482-8327-49de-9ae6-6491608f8b35" # Grogmar profile

# 1. Generate Tavern JWT (using Admin role to bypass profile ownership check)
token_payload = {
    "sub": "admin-test-user-id",
    "role": "admin",
    "email": "admin@tavernswiper.com",
    "exp": int(time.time()) + 3600
}
token = jwt.encode(token_payload, JWT_SECRET, algorithm="HS256")
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

print("🔑 Generated Admin Tavern JWT.")

def get_messages():
    url = f"{MESSAGES_SERVICE_URL}/messages/conversations/{CONVERSATION_ID}/messages?limit=5"
    response = requests.get(url, headers=headers)
    print(f"GET {url} Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print("Response typing map:")
        print(json.dumps(data.get("typing"), indent=2))
    else:
        print(f"Error: {response.text}")

# 2. Query initial messages/typing state
print("\n--- Step 1: Initial typing state ---")
get_messages()

# 3. Post typing signal
print("\n--- Step 2: Post typing signal (Grogmar is typing) ---")
typing_url = f"{MESSAGES_SERVICE_URL}/messages/conversations/{CONVERSATION_ID}/typing"
typing_payload = {
    "profile_id": TYPING_PROFILE_ID
}
response = requests.post(typing_url, json=typing_payload, headers=headers)
print(f"POST {typing_url} Status: {response.status_code}")

# 4. Query messages/typing state again (should be active)
print("\n--- Step 3: Check typing state immediately after signal ---")
get_messages()

# 5. Wait 11 seconds for TTL expiration (TTL is 10s)
print("\n--- Step 4: Sleeping for 11 seconds to let typing indicator expire ---")
time.sleep(11)

# 6. Query messages/typing state after TTL
print("\n--- Step 5: Check typing state after TTL expiration ---")
get_messages()
