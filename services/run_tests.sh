#!/bin/bash

# Tavern Swiper Microservices Test Runner
# This script runs the test suites for all 6 backend services in sequence.

set -e

SERVICES=("auth" "profiles" "discovery" "swipes" "messages" "users")
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "🛡️ Starting Tavern Swiper Microservices Test Suite..."
echo "-------------------------------------------"

# Bypass Firestore credential checks during unit testing
export GOOGLE_APPLICATION_CREDENTIALS=""
export FIRESTORE_EMULATOR_HOST="localhost:8080"
export GCLOUD_PROJECT="dummy-project"

for SERVICE in "${SERVICES[@]}"; do
    echo "🧪 Testing service: $SERVICE"
    cd "$SCRIPT_DIR/$SERVICE"
    
    # Check if tests directory exists
    if [ -d "tests" ]; then
        # Use python3 -m pytest for better compatibility
        if python3 -m pytest tests/ -v; then
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
