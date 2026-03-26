#!/bin/bash

# Trystr Microservices Test Runner
# This script runs the test suites for all 6 backend services in sequence.

set -e

SERVICES=("auth" "profiles" "discovery" "swipes" "messages" "users")
BASE_DIR=$(pwd)

echo "🛡️ Starting Trystr Microservices Test Suite..."
echo "-------------------------------------------"

for SERVICE in "${SERVICES[@]}"; do
    echo "🧪 Testing service: $SERVICE"
    cd "$BASE_DIR/$SERVICE"
    
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
