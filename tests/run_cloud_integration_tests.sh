#!/bin/bash
set -e

# Configuration
cd "$(dirname "$0")/.."
PROJECT_ID="tavern-swiper-dev"
REGION="us-central1"

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

echo "✅ URLs fetched:"
echo "  Auth:      $AUTH_SERVICE_URL"
echo "  Users:     $USERS_URL"
echo "  Profiles:  $PROFILES_URL"
echo "  Discovery: $DISCOVERY_URL"
echo "  Swipes:    $SWIPES_URL"
# Messages URL not explicitly used in test_system_init.py yet but good to have
echo "  Messages:  $MESSAGES_URL"

echo ""
echo "🧪 Running Integration Tests against Cloud Run..."

# Use project virtualenv
if [ -d ".venv" ]; then
    PYTHON=".venv/bin/python3"
else
    PYTHON="python3"
fi

$PYTHON -m pytest tests/integration/test_system_init.py -v -s
