#!/bin/bash
set -e

# Configuration
PROJECT_ID="tavern-swiper-dev"
REGION="us-central1"
SERVICE_ACCOUNT="tavern-swiper-sa@${PROJECT_ID}.iam.gserviceaccount.com"

SERVICES=("auth" "users" "profiles" "discovery" "swipes" "messages")
ENVIRONMENTS=("dev" "test")

echo "🚀 Starting Tavern Swiper Dual-Environment Cloud Run Deployment (Keyless)..."

# Store URLs: SERVICE_URLS["auth-dev"], SERVICE_URLS["auth-test"], etc.
declare -A SERVICE_URLS

# -----------------------------------------------------------------------------
# PHASE 1: Build & Initial Deploy (Establish URLs)
# -----------------------------------------------------------------------------
for SERVICE in "${SERVICES[@]}"; do
    echo "--------------------------------------------------------"
    echo "📦 Building: ${SERVICE}"
    echo "--------------------------------------------------------"
    
    # Build once per service
    gcloud builds submit "services/${SERVICE}" \
        --tag "gcr.io/${PROJECT_ID}/${SERVICE}" \
        --project "${PROJECT_ID}"
    
    for ENV in "${ENVIRONMENTS[@]}"; do
        # Service name logic: 'users' for dev, 'users-test' for test
        if [ "$ENV" == "dev" ]; then
            DEPLOY_NAME="${SERVICE}"
            DB_ID="${SERVICE}"
        else
            DEPLOY_NAME="${SERVICE}-test"
            DB_ID="${SERVICE}-test"
        fi

        # Special case for auth (if it uses (default) or something else)
        # Based on gcloud list, 'auth' and 'auth-test' exist.
        
        echo "🚀 Deploying ${DEPLOY_NAME} to Cloud Run..."
        
        gcloud run deploy "${DEPLOY_NAME}" \
            --image "gcr.io/${PROJECT_ID}/${SERVICE}" \
            --platform managed \
            --region "${REGION}" \
            --service-account "${SERVICE_ACCOUNT}" \
            --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID},FIRESTORE_DATABASE_ID=${DB_ID}" \
            --memory 512Mi \
            --cpu 1 \
            --allow-unauthenticated \
            --project "${PROJECT_ID}" \
            --quiet
        
        # Capture URL
        URL=$(gcloud run services describe "${DEPLOY_NAME}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)')
        SERVICE_URLS["${SERVICE}-${ENV}"]=$URL
        echo "✅ ${DEPLOY_NAME} deployed at: ${URL}"
    done
done

# -----------------------------------------------------------------------------
# PHASE 2: Update Inter-Service Dependencies
# -----------------------------------------------------------------------------
echo ""
echo "🔗 PHASE 2: Updating Inter-Service URLs..."

for ENV in "${ENVIRONMENTS[@]}"; do
    echo "--- Configuring ${ENV} Environment ---"
    
    AUTH_URL=${SERVICE_URLS["auth-${ENV}"]}
    USERS_URL=${SERVICE_URLS["users-${ENV}"]}
    PROFILES_URL=${SERVICE_URLS["profiles-${ENV}"]}
    SWIPES_URL=${SERVICE_URLS["swipes-${ENV}"]}
    DISCOVERY_URL=${SERVICE_URLS["discovery-${ENV}"]}
    MESSAGES_URL=${SERVICE_URLS["messages-${ENV}"]}

    # Update each service in this environment with its peers' URLs
    for SERVICE in "${SERVICES[@]}"; do
        if [ "$ENV" == "dev" ]; then
            DEPLOY_NAME="${SERVICE}"
        else
            DEPLOY_NAME="${SERVICE}-test"
        fi
        
        echo "Updating ${DEPLOY_NAME} dependencies..."
        
        # Construct env var string
        ENV_VARS="AUTH_SERVICE_URL=${AUTH_URL}"
        ENV_VARS+=",USERS_SERVICE_URL=${USERS_URL}"
        ENV_VARS+=",PROFILES_SERVICE_URL=${PROFILES_URL}"
        ENV_VARS+=",SWIPES_SERVICE_URL=${SWIPES_URL}"
        ENV_VARS+=",DISCOVERY_SERVICE_URL=${DISCOVERY_URL}"
        ENV_VARS+=",MESSAGES_SERVICE_URL=${MESSAGES_URL}"
        
        gcloud run services update "${DEPLOY_NAME}" \
            --platform managed \
            --region "${REGION}" \
            --update-env-vars "${ENV_VARS}" \
            --project "${PROJECT_ID}" \
            --quiet
    done
done

echo ""
echo "✨ Deployment Complete!"
echo "Development URLs (dev):"
for SERVICE in "${SERVICES[@]}"; do
    echo "- ${SERVICE}: ${SERVICE_URLS["${SERVICE}-dev"]}"
done

echo ""
echo "Test URLs:"
for SERVICE in "${SERVICES[@]}"; do
    echo "- ${SERVICE}-test: ${SERVICE_URLS["${SERVICE}-test"]}"
done

echo ""
echo "Next step: Use './scripts/switch_env.sh test' to point the frontend to the test cloud."

