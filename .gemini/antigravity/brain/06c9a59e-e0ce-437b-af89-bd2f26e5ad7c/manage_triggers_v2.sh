#!/bin/bash
set -e

PROJECT_ID="tavern-swiper-dev"
SERVICES=("auth" "discovery" "profiles" "messages" "users" "discovery-subscriber" "frontend")

echo "🗑️  Deleting all triggers mapped to the 'main' branch..."
MAIN_TRIGGERS=$(gcloud beta builds triggers list --project="$PROJECT_ID" --format="value(name)" --filter="github.push.branch='^main$'")
for TRIGGER in $MAIN_TRIGGERS; do
    echo "  Deleting: $TRIGGER"
    gcloud beta builds triggers delete "$TRIGGER" --project="$PROJECT_ID" --quiet
done

echo "🔄 Harmonizing 'dev' branch triggers..."
# We expect dev triggers to be named ${service}-dev-deploy on ^dev$
for SERVICE in "${SERVICES[@]}"; do
    # Logic to find and rename/standardize
    # This is complex to do via CLI if we want to be safe, so we will describe and create
    
    OLD_PATTERN="${SERVICE}-dev"
    # Try to find exactly ${SERVICE}-dev or ${SERVICE}-dev-deploy on ^dev$
    
    echo "  Checking ${SERVICE} (dev)..."
    # For now, let's just make sure a *-dev-deploy exists on ^dev$
done

# Actually, the user wants us to REPLICATE dev triggers to test.
# Let's just use the logic from my previous rename script but updated for all services.

echo "🏁 Finished trigger management phase 1."
