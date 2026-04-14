#!/bin/bash

# Configuration
cd "$(dirname "$0")/.."
TEST_COMPOSE_FILE="docker-compose-test.yml"
TESTS_DIR="tests/integration"

echo "🧹 Purging Test Environment Data..."
if [ -d ".venv" ]; then
    .venv/bin/python3 scripts/clear_system.py test
else
    python3 scripts/clear_system.py test
fi

echo "🚀 Starting Test Environment..."
docker compose -f $TEST_COMPOSE_FILE up -d --build

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
# We can use docker compose ps to wait for healthchecks if defined
# Or simple polling for the health endpoints

MAX_RETRIES=12
RETRY_INTERVAL=5
RETRIES=0

services=("auth:8001:auth/health" "profiles:8002:profiles/health" "discovery:8003:discovery/health" "messages:8005:messages/health" "users:8006:users/health" "pubsub-emulator:8085:" "discovery-subscriber:8007:")

wait_for_service() {
    local service=$1
    local port=$2
    local path=$3
    echo "⏳ Waiting for $service on port $port... ($path)"
    while ! curl -s http://localhost:$port/$path > /dev/null; do
        if [ $RETRIES -eq $MAX_RETRIES ]; then
            echo "❌ Service $service failed to become healthy."
            exit 1
        fi
        echo "Waiting for $service... ($((RETRIES+1))/$MAX_RETRIES)"
        sleep $RETRY_INTERVAL
        RETRIES=$((RETRIES+1))
    done
    echo "✅ $service is healthy!"
    RETRIES=0
}

for s in "${services[@]}"; do
    IFS=":" read -r name port path <<< "$s"
    wait_for_service "$name" "$port" "$path"
done

echo "🔧 Initializing Pub/Sub Emulator..."
# Create Topic
curl -s -X PUT "http://localhost:8085/v1/projects/tavern-swiper-dev/topics/dev-profiles-profile-events-v1"
# Create Push Subscription
curl -s -X PUT "http://localhost:8085/v1/projects/tavern-swiper-dev/subscriptions/dev-discovery-subscriber-sub" \
     -H "Content-Type: application/json" \
     -d '{
           "topic": "projects/tavern-swiper-dev/topics/dev-profiles-profile-events-v1",
           "pushConfig": {
             "pushEndpoint": "http://discovery-subscriber:8007"
           }
         }'
echo "✅ Emulator Initialized."

echo "🧪 Running Integration Tests..."
# Use the project's virtual environment if available
if [ -d ".venv" ]; then
    PYTHON=".venv/bin/python3"
else
    PYTHON="python3"
fi

# Ensure credentials are pointed to for the cleanup fixture
# Note: GOOGLE_APPLICATION_CREDENTIALS is now handled via host-mounted ADC in docker-compose-test.yml

# Ensure dependencies are installed
$PYTHON -m pip install -r tests/requirements.txt -q

# Run pytest
$PYTHON -m pytest $TESTS_DIR -v -s

# Return the exit code of pytest
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "🏁 Tests passed successfully!"
else
    echo "❌ Tests failed with exit code $EXIT_CODE"
fi

# Cleanup test environment
echo "🧹 Cleaning up test environment..."
docker compose -f $TEST_COMPOSE_FILE down

exit $EXIT_CODE
