#!/bin/bash
set -e

ENV=$1
PROJECT_ID="tavern-swiper-dev"
REGION="us-central1"
FRONTEND_ENV="frontend/.env"

if [[ -z "$ENV" ]]; then
    echo "Usage: ./scripts/switch_env.sh [local|dev|test|prod]"
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
    update_env_var "EXPO_PUBLIC_MESSAGES_URL" "http://localhost:8005"
    update_env_var "EXPO_PUBLIC_USERS_URL" "http://localhost:8006"
    update_env_var "EXPO_PUBLIC_SWIPES_URL" "http://localhost:8003"
    echo "✅ Switched to local (localhost)."
else
    echo "🔍 Fetching Cloud Run URLs for [$ENV] environment via Router..."
    
    # 1. Find the Router URL first (one gcloud call)
    if [[ "$ENV" == "dev" ]]; then
        DEPLOY_NAME="router-dev"
    elif [[ "$ENV" == "prod" ]]; then
        DEPLOY_NAME="router-prod"
    else
        DEPLOY_NAME="router-test"
    fi

    ROUTER_URL=$(gcloud run services describe "${DEPLOY_NAME}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)' 2>/dev/null || echo "NOT_FOUND")
    
    # Fallback for 'dev' environment
    if [[ "$ROUTER_URL" == "NOT_FOUND" && "$ENV" == "dev" ]]; then
        ROUTER_URL=$(gcloud run services describe "router" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)' 2>/dev/null || echo "NOT_FOUND")
    fi

    ROUTES="{}"
    if [[ "$ROUTER_URL" != "NOT_FOUND" ]]; then
        echo "  📍 Router: ${ROUTER_URL}"
        ROUTES=$(curl -sf "${ROUTER_URL}/router/services" || echo "{}")
    fi

    # 2. Check if we got the routes from the router
    HAS_ROUTER_DATA=$(echo "$ROUTES" | jq -r 'if .services then "true" else "false" end')

    if [[ "$HAS_ROUTER_DATA" == "true" ]]; then
        echo "  ✅ Routes fetched from Router"
        SERVICES=("auth" "users" "profiles" "discovery" "messages")
        for SERVICE in "${SERVICES[@]}"; do
            URL=$(echo "$ROUTES" | jq -r ".services.${SERVICE} // empty")
            if [[ -n "$URL" ]]; then
                VAR_NAME="EXPO_PUBLIC_$(echo ${SERVICE} | tr '[:lower:]' '[:upper:]')_URL"
                update_env_var "${VAR_NAME}" "${URL}"
                echo "    ✅ ${VAR_NAME}=${URL}"
                
                # Special case for swipes
                if [[ "$SERVICE" == "discovery" ]]; then
                    update_env_var "EXPO_PUBLIC_SWIPES_URL" "${URL}"
                    echo "    ✅ EXPO_PUBLIC_SWIPES_URL=${URL}"
                fi
            fi
        done
    else
        echo "  ⚠️  Router empty or unreachable. Falling back to slow gcloud discovery..."
        SERVICES=("auth" "users" "profiles" "discovery" "messages" "swipes")
        for SERVICE in "${SERVICES[@]}"; do
            ACTUAL_SERVICE=$SERVICE
            [[ "$SERVICE" == "swipes" ]] && ACTUAL_SERVICE="discovery"
            
            if [[ "$ENV" == "dev" ]]; then
                DEPLOY_NAME="${ACTUAL_SERVICE}-dev"
            elif [[ "$ENV" == "prod" ]]; then
                DEPLOY_NAME="${ACTUAL_SERVICE}-prod"
            else
                DEPLOY_NAME="${ACTUAL_SERVICE}-test"
            fi
            
            URL=$(gcloud run services describe "${DEPLOY_NAME}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)' 2>/dev/null || echo "NOT_FOUND")
            
            if [[ "$URL" == "NOT_FOUND" && "$ENV" == "dev" ]]; then
                URL=$(gcloud run services describe "${ACTUAL_SERVICE}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)' 2>/dev/null || echo "NOT_FOUND")
            fi
            
            if [[ "$URL" == "NOT_FOUND" ]]; then
                echo "    ❌ Error: Service ${ACTUAL_SERVICE} not found"
                continue
            fi

            VAR_NAME="EXPO_PUBLIC_$(echo ${SERVICE} | tr '[:lower:]' '[:upper:]')_URL"
            update_env_var "${VAR_NAME}" "${URL}"
            echo "    ✅ ${VAR_NAME}=${URL}"
        done
    fi
    echo "✅ Switched to Cloud Run (${ENV})."
fi

echo "🚀 Frontend is now configured for ${ENV}."
