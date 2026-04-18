#!/bin/bash

# Configuration
cd "$(dirname "$0")/.."
TEST_COMPOSE_FILE="docker-compose.yml"
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

if [[ "$MODE" == "local" ]]; then
    export AUTH_SERVICE_URL="http://localhost:8001"
    export PROFILES_URL="http://localhost:8002"
    export DISCOVERY_URL="http://localhost:8003"
    export MESSAGES_URL="http://localhost:8005"
    export USERS_URL="http://localhost:8006"
    export DISCOVERY_DB="discovery-dev"
    export PUBSUB_EMULATOR_HOST="localhost:8085"
    ENV_ARG="dev"
    echo "📍 Mode: LOCAL (pointing to localhost)"

else
    ENV_NAME="dev"
    [[ "$MODE" == "cloud-test" ]] && ENV_NAME="test"
    ENV_ARG=$ENV_NAME
    
    echo "🔍 Fetching Cloud Run URLs for [$ENV_NAME] environment..."
    SERVICES=("auth" "users" "profiles" "discovery" "messages")
    for SERVICE in "${SERVICES[@]}"; do
        DEPLOY_NAME="${SERVICE}-${ENV_NAME}"
        URL=$(gcloud run services describe "${DEPLOY_NAME}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)' 2>/dev/null || echo "NOT_FOUND")
        
        # Fallback for 'dev' environment
        if [[ "$URL" == "NOT_FOUND" && "$ENV_NAME" == "dev" ]]; then
            URL=$(gcloud run services describe "${SERVICE}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)' 2>/dev/null || echo "NOT_FOUND")
        fi
        
        if [[ "$URL" == "NOT_FOUND" ]]; then
            echo "⚠️  Warning: Service ${SERVICE} not found for $ENV_NAME"
            continue
        fi

        # Map to environment variables
        case $SERVICE in
            auth) export AUTH_SERVICE_URL=$URL ;;
            users) export USERS_URL=$URL ;;
            profiles) export PROFILES_URL=$URL ;;
            discovery) export DISCOVERY_URL=$URL ;;
            messages) export MESSAGES_URL=$URL ;;
        esac
        echo "  ✅ ${SERVICE}: ${URL}"
    done
    
    export DISCOVERY_DB="discovery-${ENV_NAME}"
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
        services=("auth:8001:auth/health" "profiles:8002:profiles/health" "discovery:8003:discovery/health" "messages:8005:messages/health" "users:8006:users/health" "pubsub-emulator:8085:" "discovery-subscriber:8007:" "firebase-emulator:9099:")

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
                 "pushEndpoint": "http://discovery-subscriber:8007/HandleProfileEvent"
               }
             }'
     echo "✅ Emulator Initialized."
     sleep 3 # Give Pub/Sub a moment to propagate
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

exit $EXIT_CODE
