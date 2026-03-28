#!/bin/bash

# run_maestro_tests.sh
# Orchestrates the backend and executes Maestro UI tests for the frontend.

# Exit on error
set -e

echo "🏹 Starting Maestro Onboarding Quest..."

# 1. Check if Maestro is installed
if ! command -v maestro &> /dev/null
then
    echo "❌ Maestro CLI not found. Please install it: https://maestro.mobile.dev/getting-started/installing-maestro"
    exit 1
fi

# 2. Spin up the isolated test backend
echo "🏗️  Spinning up isolated test backend..."
docker compose -f docker-compose-test.yml up -d --build

# 3. Wait for services to be healthy
echo "⏳ Waiting for microservices to attune..."
# We reuse the health check logic or just wait 15 seconds
sleep 15

# 4. Execute the Maestro Flow
echo "🎭 Running onboarding and profile creation flow..."
maestro test frontend/maestro/signup_and_forge.yaml

# 5. Cleanup (optional - comment out if you want to inspect logs)
# echo "🧹 Clearing the test realm..."
# docker compose -f docker-compose-test.yml down

echo "✅ Quest Complete! Check your Maestro output for results."
