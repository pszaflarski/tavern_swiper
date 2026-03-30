#!/bin/bash

# Tavern Swiper Microservices Test Runner
# This script runs the test suites for all 6 backend services in sequence.

set -e

SERVICES=("auth" "profiles" "discovery" "swipes" "messages" "users")
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "🛡️ Starting Tavern Swiper Microservices Test Suite..."
echo "-------------------------------------------"

# Configuration
PROJECT_ID="tavern-swiper-dev"
REGION="us-central1"

# 1. Clean Slate: Purge -test services before running suite
echo "🧹 Cleaning -test environment..."
if [ -f "$SCRIPT_DIR/../.venv/bin/python3" ]; then
    "$SCRIPT_DIR/../.venv/bin/python3" "$SCRIPT_DIR/../scripts/clear_system.py"
else
    python3 "$SCRIPT_DIR/../scripts/clear_system.py"
fi

echo "🔍 Fetching Cloud Run URLs for [test] environment..."
get_url() {
    local service=$1
    gcloud run services describe "${service}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)'
}

export AUTH_SERVICE_URL=$(get_url "auth-test")
export USERS_URL=$(get_url "users-test")
export PROFILES_URL=$(get_url "profiles-test")
export DISCOVERY_URL=$(get_url "discovery-test")
export SWIPES_URL=$(get_url "swipes-test")
export MESSAGES_URL=$(get_url "messages-test")

# For the Auth service client initialization
export FIRESTORE_DATABASE_ID="auth-test"
export USERS_DATABASE_ID="users-test"
export FIREBASE_WEB_API_KEY="dummy-key-for-unit-tests"

echo "✅ Environment Ready"

for SERVICE in "${SERVICES[@]}"; do
    echo "🧪 Testing service: $SERVICE"
    # Use the root venv if it exists
    if [ -f "$SCRIPT_DIR/../.venv/bin/python3" ]; then
        PYTHON="$SCRIPT_DIR/../.venv/bin/python3"
    else
        PYTHON="python3"
    fi
    
    cd "$SCRIPT_DIR/$SERVICE"
    
    # Check if tests directory exists
    if [ -d "tests" ]; then
        if $PYTHON -m pytest tests/ -v; then
            echo "✅ $SERVICE: Tests passed!"
        else
            echo "❌ $SERVICE: Tests failed!"
            exit 1
        fi
    else
        echo "⚠️ $SERVICE: No tests directory found, skipping."
    fi
    
    echo "-------------------------------------------"
done

echo "🎉 All service tests passed successfully!"
