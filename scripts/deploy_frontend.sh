#!/bin/bash
set -e

# Configuration
PROJECT_ID="tavern-swiper-dev"
REGION="us-central1"
SERVICE_ACCOUNT="tavern-swiper-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# Firebase Config (Shared across environments in this project)
FIREBASE_API_KEY="AIzaSyCnKm4gayoO0C35CNeMJ7E82fFITvVpGAw"
FIREBASE_AUTH_DOMAIN="tavern-swiper-dev.firebaseapp.com"
FIREBASE_PROJECT_ID="tavern-swiper-dev"
FIREBASE_STORAGE_BUCKET="tavern-swiper-dev.firebasestorage.app"
FIREBASE_MESSAGING_SENDER_ID="374390417125"
FIREBASE_APP_ID="1:374390417125:web:ec1e664137daa9df11960c"

# Check dependencies
if ! command -v docker &> /dev/null; then
    echo "❌ Error: docker is not installed."
    exit 1
fi

if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud is not installed."
    exit 1
fi

# Configure Docker for GCR
echo "🔐 Configuring Docker for Google Container Registry..."
gcloud auth configure-docker gcr.io --quiet

SELECTED_ENV=$1
ENVIRONMENTS=("dev" "test")

if [[ -n "$SELECTED_ENV" ]]; then
    if [[ "$SELECTED_ENV" == "dev" || "$SELECTED_ENV" == "test" ]]; then
        ENVIRONMENTS=("$SELECTED_ENV")
    else
        echo "❌ Error: Invalid environment '$SELECTED_ENV'. Use 'dev' or 'test'."
        exit 1
    fi
fi

echo "🚀 Starting Frontend Deployment for: ${ENVIRONMENTS[*]}..."

# Function to fetch service URL
get_service_url() {
    local SERVICE_NAME=$1
    echo "Fetching URL for ${SERVICE_NAME}..." >&2
    URL=$(gcloud run services describe "${SERVICE_NAME}" \
        --platform managed \
        --region "${REGION}" \
        --project "${PROJECT_ID}" \
        --format 'value(status.url)' 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$URL" == "NOT_FOUND" ]; then
        echo "❌ Error: Backend service ${SERVICE_NAME} not found. Ensure backend is deployed first." >&2
        exit 1
    fi
    echo "$URL"
}

for ENV in "${ENVIRONMENTS[@]}"; do
    echo ""
    echo "--------------------------------------------------------"
    echo "🏗️  Environment: ${ENV}"
    echo "--------------------------------------------------------"

    # Define Service Name for the Frontend
    if [ "$ENV" == "dev" ]; then
        FRONTEND_SERVICE="app"
        SUFFIX=""
    else
        FRONTEND_SERVICE="app-test"
        SUFFIX="-test"
    fi

    # Fetch Backend Service URLs for this environment
    AUTH_URL=$(get_service_url "auth${SUFFIX}")
    USERS_URL=$(get_service_url "users${SUFFIX}")
    PROFILES_URL=$(get_service_url "profiles${SUFFIX}")
    DISCOVERY_URL=$(get_service_url "discovery${SUFFIX}")
    SWIPES_URL=$(get_service_url "swipes${SUFFIX}")
    MESSAGES_URL=$(get_service_url "messages${SUFFIX}")

    # Build Arguments
    BUILD_ARGS=(
        "--build-arg" "EXPO_PUBLIC_AUTH_URL=${AUTH_URL}"
        "--build-arg" "EXPO_PUBLIC_USERS_URL=${USERS_URL}"
        "--build-arg" "EXPO_PUBLIC_PROFILES_URL=${PROFILES_URL}"
        "--build-arg" "EXPO_PUBLIC_DISCOVERY_URL=${DISCOVERY_URL}"
        "--build-arg" "EXPO_PUBLIC_SWIPES_URL=${SWIPES_URL}"
        "--build-arg" "EXPO_PUBLIC_MESSAGES_URL=${MESSAGES_URL}"
        "--build-arg" "EXPO_PUBLIC_FIREBASE_API_KEY=${FIREBASE_API_KEY}"
        "--build-arg" "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN}"
        "--build-arg" "EXPO_PUBLIC_FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID}"
        "--build-arg" "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=${FIREBASE_STORAGE_BUCKET}"
        "--build-arg" "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${FIREBASE_MESSAGING_SENDER_ID}"
        "--build-arg" "EXPO_PUBLIC_FIREBASE_APP_ID=${FIREBASE_APP_ID}"
    )

    IMAGE_TAG="gcr.io/${PROJECT_ID}/${FRONTEND_SERVICE}:latest"

    echo "📦 Building Docker image for ${FRONTEND_SERVICE}..."
    docker build --platform linux/amd64 -t "${IMAGE_TAG}" "${BUILD_ARGS[@]}" ./frontend

    echo "⬆️  Pushing image ${IMAGE_TAG}..."
    docker push "${IMAGE_TAG}"

    echo "🚀 Deploying ${FRONTEND_SERVICE} to Cloud Run..."
    gcloud run deploy "${FRONTEND_SERVICE}" \
        --image "${IMAGE_TAG}" \
        --platform managed \
        --region "${REGION}" \
        --service-account "${SERVICE_ACCOUNT}" \
        --memory 512Mi \
        --cpu 1 \
        --allow-unauthenticated \
        --project "${PROJECT_ID}" \
        --quiet

    DONE_URL=$(gcloud run services describe "${FRONTEND_SERVICE}" --platform managed --region "${REGION}" --project "${PROJECT_ID}" --format 'value(status.url)')
    echo "✅ ${FRONTEND_SERVICE} deployed at: ${DONE_URL}"
done

echo ""
echo "✨ Frontend Deployment Complete!"
