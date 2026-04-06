#!/bin/bash
PROJECT_ID="tavern-swiper-dev"
REGION="us-central1"

get_url() {
    local service=$1
    gcloud run services describe "${service}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)'
}

export AUTH_URL=$(get_url "auth-test")
export USERS_URL=$(get_url "users-test")
export PROFILES_URL=$(get_url "profiles-test")
export DISCOVERY_URL=$(get_url "discovery-test")
export SWIPES_URL=$(get_url "swipes-test")
export MESSAGES_URL=$(get_url "messages-test")

echo "Purging Cloud Test Environment..."
python3 scripts/clear_system.py
