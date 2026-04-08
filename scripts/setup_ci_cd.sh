#!/bin/bash
set -e

# Configuration
REPO_OWNER="pszaflarski"
REPO_NAME="tavern_swiper"
PROJECT_ID="tavern-swiper-dev"
REGION="us-central1"

BACKEND_SERVICES=("auth" "users" "profiles" "discovery" "messages")

echo "🧪 Checking for gcloud beta components..."
if ! gcloud beta --help &> /dev/null; then
    echo "❌ Error: 'gcloud beta' components are required for trigger creation via CLI."
    echo "Please run: gcloud components install beta"
    exit 1
fi

create_trigger() {
    local SERVICE=$1
    local ENV=$2  # "dev" or "test"
    
    if [ "$ENV" == "dev" ]; then
        local BRANCH="main"
        local SUFFIX=""
        local DB_ID="$SERVICE"
        local TRIGGER_NAME="${SERVICE}-dev-deploy"
    else
        local BRANCH="test"
        local SUFFIX="-test"
        local DB_ID="${SERVICE}-test"
        local TRIGGER_NAME="${SERVICE}-test-deploy"
    fi

    echo "⚙️  Configuring Trigger: $TRIGGER_NAME (Branch: $BRANCH)..."

    # Determine paths based on if it's backend or frontend
    if [ "$SERVICE" == "frontend" ]; then
        local CONFIG="frontend/cloudbuild.yaml"
        local INCLUDE="frontend/**"
        # Frontend substitutions differ slightly 
        local SUBS="_ENV_SUFFIX=${SUFFIX}"
    else
        local CONFIG="services/cloudbuild.yaml"
        local INCLUDE="services/${SERVICE}/**"
        local SUBS="_SERVICE_NAME=${SERVICE},_ENV_SUFFIX=${SUFFIX},_DB_ID=${DB_ID}"
    fi

    # Create the trigger
    # Note: We use --quiet to avoid interactive prompts
    gcloud beta builds triggers create github \
        --name="$TRIGGER_NAME" \
        --repo-owner="$REPO_OWNER" \
        --repo-name="$REPO_NAME" \
        --branch-pattern="^${BRANCH}$" \
        --build-config="$CONFIG" \
        --included-files="$INCLUDE" \
        --substitutions="$SUBS" \
        --service-account="projects/${PROJECT_ID}/serviceAccounts/cicd-builder@${PROJECT_ID}.iam.gserviceaccount.com" \
        --project="$PROJECT_ID" \
        --quiet
}

echo "🚀 Starting Automated CI/CD Setup for Tavern Swiper..."

# 1. Backend Triggers
for SERVICE in "${BACKEND_SERVICES[@]}"; do
    create_trigger "$SERVICE" "dev"
    create_trigger "$SERVICE" "test"
done

# 2. Frontend Triggers
create_trigger "frontend" "dev"
create_trigger "frontend" "test"

echo ""
echo "✨ All 12 triggers have been initiated!"
echo "Check your Cloud Build console: https://console.cloud.google.com/cloud-build/triggers"
