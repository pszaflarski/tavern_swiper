#!/bin/bash
set -e

# Configuration
cd "$(dirname "$0")/.."
PROJECT_ID="tavern-swiper-dev"
REGION="us-central1"

ENV=${1:-dev}

echo "🔍 Fetching Cloud Run URLs for [${ENV}] environment..."

get_url() {
    local service=$1
    local deploy_name="${service}-${ENV}"
    
    # Try with suffix first
    local url=$(gcloud run services describe "${deploy_name}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)' 2>/dev/null || echo "")
    
    # Fallback to unsuffixed for dev if needed
    if [[ -z "$url" && "$ENV" == "dev" ]]; then
        url=$(gcloud run services describe "${service}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)' 2>/dev/null || echo "")
    fi
    
    echo "$url"
}

export AUTH_SERVICE_URL=$(get_url "auth")
export USERS_URL=$(get_url "users")
export PROFILES_URL=$(get_url "profiles")
export DISCOVERY_URL=$(get_url "discovery")
export MESSAGES_URL=$(get_url "messages")

echo "✅ URLs fetched:"
echo "  Auth:      $AUTH_SERVICE_URL"
echo "  Users:     $USERS_URL"
echo "  Profiles:  $PROFILES_URL"
echo "  Discovery: $DISCOVERY_URL"
echo "  Messages:  $MESSAGES_URL"

if [[ -z "$AUTH_SERVICE_URL" ]]; then
    echo "❌ Error: Could not fetch URLs for environment ${ENV}. Check your gcloud authentication and project ID."
    exit 1
fi

echo ""
echo "🧪 Running Integration Tests against Cloud Run [${ENV}]..."

# Use project virtualenv
if [ -d ".venv" ]; then
    PYTHON=".venv/bin/python3"
else
    PYTHON="python3"
fi

$PYTHON -m pytest tests/integration/test_system_init.py -v -s
