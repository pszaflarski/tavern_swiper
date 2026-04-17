#!/bin/bash

# Configuration
cd "$(dirname "$0")/.."
TEST_COMPOSE_FILE="docker-compose-test.yml"
TESTS_DIR="tests/integration"

# Default Mode: Cloud Dev
MODE="cloud-dev"
RESET=true

for arg in "$@"; do
    case $arg in
        --test)
            MODE="cloud-test"
            shift
            ;;
        --local)
            MODE="local"
            shift
            ;;
        --no-reset)
            RESET=false
            shift
            ;;
    esac
done

echo "🌍 Running Integration Tests in mode: $MODE (Reset: $RESET)"

# ---------------------------------------------------------------------------
# 1. Setup Environment & URLs
# ---------------------------------------------------------------------------
PROJECT_ID="tavern-swiper-dev"
REGION="us-central1"

get_url() {
    local service=$1
    local env=$2
    local deploy_name="${service}-${env}"
    local url=$(gcloud run services describe "${deploy_name}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)' 2>/dev/null || echo "")
    if [[ -z "$url" && "$env" == "dev" ]]; then
        url=$(gcloud run services describe "${service}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)' 2>/dev/null || echo "")
    fi
    echo "$url"
}

if [[ "$MODE" == "local" ]]; then
    export AUTH_SERVICE_URL="http://localhost:8001"
    export PROFILES_URL="http://localhost:8002"
    export USERS_URL="http://localhost:8006"
    export DISCOVERY_DB="discovery-dev"
    export PUBSUB_EMULATOR_HOST="localhost:8085"
    ENV_ARG="dev"

elif [[ "$MODE" == "cloud-dev" ]]; then
    ENV_ARG="dev"
    echo "🔍 Fetching Cloud Run URLs for [dev] environment..."
    export AUTH_SERVICE_URL=$(get_url "auth" "dev")
    export PROFILES_URL=$(get_url "profiles" "dev")
    export USERS_URL=$(get_url "users" "dev")
    export DISCOVERY_URL=$(get_url "discovery" "dev")
    export MESSAGES_URL=$(get_url "messages" "dev")
    export APP_URL=$(get_url "app" "dev")
    export DISCOVERY_DB="discovery-dev"
    export PUBSUB_EMULATOR_HOST=""

elif [[ "$MODE" == "cloud-test" ]]; then
    ENV_ARG="test"
    echo "🔍 Fetching Cloud Run URLs for [test] environment..."
    export AUTH_SERVICE_URL=$(get_url "auth" "test")
    export PROFILES_URL=$(get_url "profiles" "test")
    export USERS_URL=$(get_url "users" "test")
    export DISCOVERY_URL=$(get_url "discovery" "test")
    export MESSAGES_URL=$(get_url "messages" "test")
    export APP_URL=$(get_url "app" "test")
    export DISCOVERY_DB="discovery-test"
    export PUBSUB_EMULATOR_HOST=""
fi

# Use the project's virtual environment if available
if [ -d ".venv" ]; then
    PYTHON=".venv/bin/python3"
else
    PYTHON="python3"
fi

# ---------------------------------------------------------------------------
# 2. System Reset
# ---------------------------------------------------------------------------
if [[ "$RESET" == "true" ]]; then
    echo "🧹 Purging Environment Data ($ENV_ARG)..."
    $PYTHON scripts/clear_system.py $ENV_ARG

    if [[ "$MODE" == "local" ]]; then
        echo "🚀 Starting Local Test Environment (Docker)..."
        docker compose -f $TEST_COMPOSE_FILE up -d --build
        
        # Wait for services to be healthy
        echo "⏳ Waiting for local services..."
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
                    echo "❌ Service $service failed to become healthy. Check Docker logs."
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
    fi

    # Note: We do NOT create_root_admin or seed_profiles here because 
    # the integration tests (test_system_init.py) verify the initialization 
    # flow themselves. For manual seeding, run the scripts directly.
fi

# ---------------------------------------------------------------------------
# 3. Local Emulator Initialization
# ---------------------------------------------------------------------------
if [[ "$MODE" == "local" && "$RESET" == "true" ]]; then
    echo "🔧 Initializing Local Pub/Sub Emulator..."
    curl -s -X PUT "http://localhost:8085/v1/projects/tavern-swiper-dev/topics/dev-profiles-profile-events-v1"
    curl -s -X PUT "http://localhost:8085/v1/projects/tavern-swiper-dev/subscriptions/dev-discovery-subscriber-sub" \
         -H "Content-Type: application/json" \
         -d '{
               "topic": "projects/tavern-swiper-dev/topics/dev-profiles-profile-events-v1",
               "pushConfig": {
                 "pushEndpoint": "http://discovery-subscriber:8007"
               }
             }'
    echo "✅ Emulator Initialized."
fi

# ---------------------------------------------------------------------------
# 4. Run Integration Tests
# ---------------------------------------------------------------------------
echo "🧪 Running Integration Tests..."
$PYTHON -m pip install -r tests/requirements.txt -q
$PYTHON -m pytest $TESTS_DIR -v -s

# Return the exit code of pytest
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "🏁 Tests passed successfully in $MODE mode!"
else
    echo "❌ Tests failed in $MODE mode with exit code $EXIT_CODE"
fi

# Cleanup local test environment if used
if [[ "$MODE" == "local" ]]; then
    echo "🧹 Cleaning up local test environment..."
    docker compose -f $TEST_COMPOSE_FILE down
fi

exit $EXIT_CODE

exit $EXIT_CODE
