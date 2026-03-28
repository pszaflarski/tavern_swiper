#!/bin/bash

# Configuration
TEST_COMPOSE_FILE="docker-compose-test.yml"
TESTS_DIR="tests/integration"

echo "🚀 Starting Test Environment..."
docker compose -f $TEST_COMPOSE_FILE up -d --build

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
# We can use docker compose ps to wait for healthchecks if defined
# Or simple polling for the health endpoints

MAX_RETRIES=12
RETRY_INTERVAL=5
RETRIES=0

services=("auth:8001" "profiles:8002" "users:8006")

wait_for_service() {
    local service=$1
    local port=$2
    while ! curl -s http://localhost:$port/${service}/health | grep -q 'ok'; do
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
    IFS=":" read -r name port <<< "$s"
    wait_for_service "$name" "$port"
done

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
