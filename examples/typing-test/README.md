# Typing Indicator Test Example

This example demonstrates how to test and verify the typing indicator event flow against the local `messages_go` microservice.

## Prerequisites

1. Active Application Default Credentials (ADC) to access the dev Firestore database:
   ```bash
   gcloud auth application-default login
   ```
2. Python virtual environment with `PyJWT` and `requests` installed:
   ```bash
   pip install pyjwt requests
   ```

## Setup & Running the Local Service

1. Configure the local `messages_go` environment to use the Cloud Dev Router. In `services/messages/messages_go/.env`, update `ROUTER_SERVICE_URL` and `GOOGLE_CLOUD_PROJECT`:
   ```env
   ROUTER_SERVICE_URL=https://router-dev-hhqol7siba-uc.a.run.app
   GOOGLE_CLOUD_PROJECT=tavern-swiper-dev
   ```

2. Export the required variables and run `air` from the `services/messages/messages_go` directory:
   ```bash
   export GOOGLE_CLOUD_PROJECT=tavern-swiper-dev \
          FIRESTORE_DATABASE_ID=messages-dev \
          ROUTER_SERVICE_URL=https://router-dev-hhqol7siba-uc.a.run.app \
          GOOGLE_APPLICATION_CREDENTIALS=~/.config/gcloud/application_default_credentials.json \
          PORT=8005
   cd services/messages/messages_go && air
   ```

## Running the Test Script

Execute the typing test script using your virtual environment Python binary:
```bash
python test_typing.py
```

### Expected Behavior

1. **Step 1**: Initial state is checked and the response `typing` map is `null`.
2. **Step 2**: A `POST` request is sent to `/messages/conversations/{id}/typing` with a profile ID.
3. **Step 3**: The GET messages response shows the profile ID registered under `typing` with its write timestamp.
4. **Step 4**: The script waits 11 seconds.
5. **Step 5**: The next GET request is sent, and the typing map is returned as `null` again because the 10-second TTL expired.
