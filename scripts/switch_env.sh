#!/bin/bash
set -e

ENV=$1
PROJECT_ID="tavern-swiper-dev"
REGION="us-central1"
FRONTEND_ENV="../frontend/.env"

if [[ -z "$ENV" ]]; then
    echo "Usage: ./scripts/switch_env.sh [local|dev|test]"
    exit 1
fi

echo "🔄 Switching frontend environment to: ${ENV}..."

# Backup current .env
cp "${FRONTEND_ENV}" "${FRONTEND_ENV}.bak"

update_env_var() {
    VAR_NAME=$1
    VALUE=$2
    # Use sed to update or append the variable
    if grep -q "^${VAR_NAME}=" "${FRONTEND_ENV}"; then
        sed -i "s|^${VAR_NAME}=.*|${VAR_NAME}=${VALUE}|" "${FRONTEND_ENV}"
    else
        echo "${VAR_NAME}=${VALUE}" >> "${FRONTEND_ENV}"
    fi
}

if [[ "$ENV" == "local" ]]; then
    update_env_var "EXPO_PUBLIC_AUTH_URL" "http://localhost:8001"
    update_env_var "EXPO_PUBLIC_PROFILES_URL" "http://localhost:8002"
    update_env_var "EXPO_PUBLIC_DISCOVERY_URL" "http://localhost:8003"
    update_env_var "EXPO_PUBLIC_SWIPES_URL" "http://localhost:8004"
    update_env_var "EXPO_PUBLIC_MESSAGES_URL" "http://localhost:8005"
    update_env_var "EXPO_PUBLIC_USERS_URL" "http://localhost:8006"
    echo "✅ Switched to local (localhost)."
else
    SERVICES=("auth" "users" "profiles" "discovery" "swipes" "messages")
    for SERVICE in "${SERVICES[@]}"; do
        if [[ "$ENV" == "dev" ]]; then
            DEPLOY_NAME="${SERVICE}"
        else
            DEPLOY_NAME="${SERVICE}-test"
        fi
        
        echo "Fetching URL for ${DEPLOY_NAME}..."
        URL=$(gcloud run services describe "${DEPLOY_NAME}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)' 2>/dev/null || echo "NOT_FOUND")
        
        if [[ "$URL" == "NOT_FOUND" ]]; then
            echo "⚠️ Warning: Service ${DEPLOY_NAME} not found on Cloud Run."
            continue
        fi

        # Map SERVICE name to EXPO_PUBLIC_*_URL
        VAR_NAME="EXPO_PUBLIC_$(echo ${SERVICE} | tr '[:lower:]' '[:upper:]')_URL"
        update_env_var "${VAR_NAME}" "${URL}"
        echo "✅ ${VAR_NAME}=${URL}"
    done
    echo "✅ Switched to Cloud Run (${ENV})."
fi

echo "🚀 Frontend is now configured for ${ENV}."
