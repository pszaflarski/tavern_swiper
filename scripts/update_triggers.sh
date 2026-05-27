#!/bin/bash
# Update all Cloud Build triggers with ROUTER_SERVICE_URL and ROUTER_TAG
# Uses gcloud beta export/import since standard update has issues with GitHub triggers

set -e

PROJECT="tavern-swiper-dev"
TMPFILE="/tmp/trigger_update.yaml"

# Resolve router URLs dynamically (fallback to env vars if gcloud unavailable)
ROUTER_DEV_URL="${ROUTER_DEV_URL:-$(gcloud run services describe router-dev --project=$PROJECT --region=us-central1 --format='value(status.url)' 2>/dev/null || echo '')}"
ROUTER_TEST_URL="${ROUTER_TEST_URL:-$(gcloud run services describe router-test --project=$PROJECT --region=us-central1 --format='value(status.url)' 2>/dev/null || echo '')}"

if [ -z "$ROUTER_DEV_URL" ] || [ -z "$ROUTER_TEST_URL" ]; then
  echo "ERROR: Could not resolve router URLs. Set ROUTER_DEV_URL and ROUTER_TEST_URL env vars, or ensure gcloud is authenticated."
  exit 1
fi

# Map: trigger_name -> router_url
declare -A TRIGGERS
# Dev triggers
TRIGGERS["router-dev-deploy"]="$ROUTER_DEV_URL"
TRIGGERS["auth-dev-deploy"]="$ROUTER_DEV_URL"
TRIGGERS["users-dev-deploy"]="$ROUTER_DEV_URL"
TRIGGERS["profiles-dev-deploy"]="$ROUTER_DEV_URL"
TRIGGERS["discovery-dev-deploy"]="$ROUTER_DEV_URL"
TRIGGERS["discovery-subscriber-dev-deploy"]="$ROUTER_DEV_URL"
TRIGGERS["messages-dev-deploy"]="$ROUTER_DEV_URL"
TRIGGERS["messages-subscriber-dev-deploy"]="$ROUTER_DEV_URL"
TRIGGERS["quests-dev-deploy"]="$ROUTER_DEV_URL"
TRIGGERS["characters-dev-deploy"]="$ROUTER_DEV_URL"
# Test triggers
TRIGGERS["router-test-deploy"]="$ROUTER_TEST_URL"
TRIGGERS["auth-test-deploy"]="$ROUTER_TEST_URL"
TRIGGERS["users-test-deploy"]="$ROUTER_TEST_URL"
TRIGGERS["profiles-test-deploy"]="$ROUTER_TEST_URL"
TRIGGERS["discovery-test-deploy"]="$ROUTER_TEST_URL"
TRIGGERS["discovery-subscriber-test-deploy"]="$ROUTER_TEST_URL"
TRIGGERS["messages-test-deploy"]="$ROUTER_TEST_URL"
TRIGGERS["messages-subscriber-test-deploy"]="$ROUTER_TEST_URL"
TRIGGERS["quests-test-deploy"]="$ROUTER_TEST_URL"
TRIGGERS["characters-test-deploy"]="$ROUTER_TEST_URL"

for TRIGGER_NAME in "${!TRIGGERS[@]}"; do
  ROUTER_URL="${TRIGGERS[$TRIGGER_NAME]}"
  
  # Get trigger ID
  TRIGGER_ID=$(gcloud builds triggers list --project=$PROJECT --filter="name=$TRIGGER_NAME" --format="value(id)" 2>/dev/null)
  
  if [ -z "$TRIGGER_ID" ]; then
    echo "⚠️  Trigger $TRIGGER_NAME not found, skipping"
    continue
  fi

  # Export
  gcloud beta builds triggers export "$TRIGGER_ID" --project=$PROJECT --destination=$TMPFILE 2>/dev/null

  # Check if already has ROUTER_SERVICE_URL
  if grep -q "_ROUTER_SERVICE_URL" $TMPFILE; then
    echo "⏭️  $TRIGGER_NAME already has _ROUTER_SERVICE_URL, updating value..."
    sed -i "s|_ROUTER_SERVICE_URL:.*|_ROUTER_SERVICE_URL: $ROUTER_URL|" $TMPFILE
    sed -i "s|_ROUTER_TAG:.*|_ROUTER_TAG: default|" $TMPFILE
  else
    # Add substitutions before the last line of substitutions block
    sed -i "/^substitutions:/a\\  _ROUTER_SERVICE_URL: $ROUTER_URL\n  _ROUTER_TAG: default" $TMPFILE
  fi

  # Import back
  gcloud beta builds triggers import --project=$PROJECT --source=$TMPFILE 2>/dev/null
  echo "✅ $TRIGGER_NAME → $ROUTER_URL"
done

rm -f $TMPFILE
echo ""
echo "🎯 All triggers updated!"
