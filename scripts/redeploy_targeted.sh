#!/bin/bash
set -e

# Configuration
PROJECT_ID="tavern-swiper-dev"
REGION="us-central1"
SERVICE_ACCOUNT="tavern-swiper-sa@${PROJECT_ID}.iam.gserviceaccount.com"

TARGET_SERVICES=("users" "profiles")
ENVIRONMENTS=("dev" "test")

# URLs (Extracted from previous gcloud list)
declare -A AUTH_URLS
AUTH_URLS["dev"]="https://auth-hhqol7siba-uc.a.run.app"
AUTH_URLS["test"]="https://auth-test-hhqol7siba-uc.a.run.app"

declare -A USERS_URLS
USERS_URLS["dev"]="https://users-hhqol7siba-uc.a.run.app"
USERS_URLS["test"]="https://users-test-hhqol7siba-uc.a.run.app"

declare -A PROFILES_URLS
PROFILES_URLS["dev"]="https://profiles-hhqol7siba-uc.a.run.app"
PROFILES_URLS["test"]="https://profiles-test-hhqol7siba-uc.a.run.app"

declare -A SWIPES_URLS
SWIPES_URLS["dev"]="https://swipes-hhqol7siba-uc.a.run.app"
SWIPES_URLS["test"]="https://swipes-test-hhqol7siba-uc.a.run.app"

declare -A DISCOVERY_URLS
DISCOVERY_URLS["dev"]="https://discovery-hhqol7siba-uc.a.run.app"
DISCOVERY_URLS["test"]="https://discovery-test-hhqol7siba-uc.a.run.app"

declare -A MESSAGES_URLS
MESSAGES_URLS["dev"]="https://messages-hhqol7siba-uc.a.run.app"
MESSAGES_URLS["test"]="https://messages-test-hhqol7siba-uc.a.run.app"

for SERVICE in "${TARGET_SERVICES[@]}"; do
    echo "--------------------------------------------------------"
    echo "📦 Building: ${SERVICE}"
    echo "--------------------------------------------------------"
    
    gcloud builds submit "services/${SERVICE}" \
        --tag "gcr.io/${PROJECT_ID}/${SERVICE}" \
        --project "${PROJECT_ID}"
    
    for ENV in "${ENVIRONMENTS[@]}"; do
        if [ "$ENV" == "dev" ]; then
            DEPLOY_NAME="${SERVICE}"
            DB_ID="${SERVICE}"
        else
            DEPLOY_NAME="${SERVICE}-test"
            DB_ID="${SERVICE}-test"
        fi

        echo "🚀 Deploying ${DEPLOY_NAME} to Cloud Run..."
        
        # Base environment variables
        ENV_VARS="GOOGLE_CLOUD_PROJECT=${PROJECT_ID}"
        ENV_VARS+=",FIRESTORE_DATABASE_ID=${DB_ID}"
        ENV_VARS+=",GCS_BUCKET_NAME=tavern-swiper-dev-media"
        
        # Inter-service URLs
        ENV_VARS+=",AUTH_SERVICE_URL=${AUTH_URLS[$ENV]}"
        ENV_VARS+=",USERS_SERVICE_URL=${USERS_URLS[$ENV]}"
        ENV_VARS+=",PROFILES_SERVICE_URL=${PROFILES_URLS[$ENV]}"
        ENV_VARS+=",SWIPES_SERVICE_URL=${SWIPES_URLS[$ENV]}"
        ENV_VARS+=",DISCOVERY_SERVICE_URL=${DISCOVERY_URLS[$ENV]}"
        ENV_VARS+=",MESSAGES_SERVICE_URL=${MESSAGES_URLS[$ENV]}"

        gcloud run deploy "${DEPLOY_NAME}" \
            --image "gcr.io/${PROJECT_ID}/${SERVICE}" \
            --platform managed \
            --region "${REGION}" \
            --service-account "${SERVICE_ACCOUNT}" \
            --set-env-vars "${ENV_VARS}" \
            --memory "512Mi" \
            --cpu "1" \
            --timeout "60" \
            --cpu-boost \
            --allow-unauthenticated \
            --project "${PROJECT_ID}" \
            --quiet
        
        echo "✅ ${DEPLOY_NAME} redeployed."
    done
done

echo "✨ Targeted Redeployment Complete!"
