#!/bin/bash
set -e

# Tavern Swiper E2E Orchestration (Cloud Strategy)
# This script kills any existing Expo/Metro bundler on port 8081
# and runs Playwright tests against the configured Cloud Run services.

PORT=8081

echo "🧹 Cleaning up existing local Expo/Metro processes on port ${PORT}..."
# Find and kill the process using port 8081 (tcp)
PID=$(lsof -t -i:${PORT} || true)

if [ -n "$PID" ]; then
    echo "📍 Found process ${PID} on port ${PORT}. Terminating..."
    kill -9 $PID
    sleep 2
    echo "✅ Port ${PORT} is now free."
else
    echo "✅ No process found on port ${PORT}."
fi

echo "🚀 Starting Playwright E2E tests against Cloud Services..."
echo "📍 Configuration: Targeting base URL from frontend/.env (typically http://localhost:8081 for the bundler)"

cd frontend

# Run Playwright tests. Playwright's webServer config in playwright.config.ts
# will start the expo dev server automatically if it's not running.
# Since we just killed it, Playwright will start a fresh one.
npx playwright test e2e/image-visibility.spec.ts --project=chromium

echo "✨ E2E Test Execution Complete!"
