import os
import sys
import requests

KEYS = {
    "frontend": os.environ.get("FRONTEND_API_KEY", ""),
    "auth_service": os.environ.get("AUTH_SERVICE_API_KEY", ""),
}

if not all(KEYS.values()):
    print("ERROR: Set FRONTEND_API_KEY and AUTH_SERVICE_API_KEY env vars")
    print("  export FRONTEND_API_KEY=<your Firebase Web API key>")
    print("  export AUTH_SERVICE_API_KEY=<your auth service Firebase key>")
    sys.exit(1)

def verify_key(name, key):
    # We use a non-existent email/password to see what error the API returns.
    # If the key is invalid, we'll get an "INVALID_API_KEY" error.
    # If the key is valid, we'll get "EMAIL_NOT_FOUND" or similar.
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={key}"
    payload = {
        "email": "verify-test@example.com",
        "password": "some-password",
        "returnSecureToken": True
    }
    
    try:
        response = requests.post(url, json=payload, timeout=10)
        data = response.json()
        
        if response.status_code == 200:
            print(f"✅ Key '{name}' is VALID (Unexpected success with dummy data?!)")
            return True
        else:
            error = data.get("error", {})
            message = error.get("message", "Unknown error")
            if "API key not valid" in message or "INVALID_API_KEY" in message:
                print(f"❌ Key '{name}' is INVALID: {message}")
                return False
            else:
                print(f"✅ Key '{name}' is VALID (Received expected user-level error: {message})")
                return True
    except Exception as e:
        print(f"⚠️ Error testing key '{name}': {e}")
        return False

if __name__ == "__main__":
    for name, key in KEYS.items():
        verify_key(name, key)
