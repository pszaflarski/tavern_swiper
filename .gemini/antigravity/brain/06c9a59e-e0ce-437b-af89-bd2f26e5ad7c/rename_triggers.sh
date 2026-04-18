#!/bin/bash
set -e

SERVICES=("auth" "discovery" "profiles" "messages" "users")
PROJECT_ID="tavern-swiper-dev"

for SERVICE in "${SERVICES[@]}"; do
  OLD_NAME="${SERVICE}-dev"
  NEW_NAME="${SERVICE}-dev-deploy"
  DIR_NAME="${SERVICE}_go"
  
  echo "🔄 Processing ${SERVICE} (dev)..."
  
  # 1. Fetch existing trigger details
  TRIGGER_JSON=$(gcloud beta builds triggers describe "$OLD_NAME" --project="$PROJECT_ID" --format=json)
  
  # Extract basic fields
  DB_ID=$(echo "$TRIGGER_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['substitutions']['_DB_ID'])")
  
  # Prepare substitutions
  SUBS="_DIR_NAME=${DIR_NAME},_DB_ID=${DB_ID},_ENV_NAME=dev,_ENV_SUFFIX=-dev,_SERVICE_NAME=${SERVICE}"
  
  # Handle service-specific substitutions
  if [[ "$SERVICE" == "auth" ]]; then
    USERS_DB_ID=$(echo "$TRIGGER_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['substitutions']['_USERS_DB_ID'])")
    FIREBASE_KEY=$(echo "$TRIGGER_JSON" | python3 -c "import sys, json; print(json.load(sys.stdin)['substitutions']['_FIREBASE_WEB_API_KEY'])")
    SUBS="${SUBS},_USERS_DB_ID=${USERS_DB_ID},_FIREBASE_WEB_API_KEY=${FIREBASE_KEY}"
  fi
  
  # Create new trigger
  echo "  Creating new trigger: $NEW_NAME"
  gcloud beta builds triggers create github \
    --name="$NEW_NAME" \
    --project="$PROJECT_ID" \
    --repo-name="tavern_swiper" \
    --repo-owner="pszaflarski" \
    --branch-pattern="^dev$" \
    --build-config="services/${DIR_NAME}/cloudbuild.yaml" \
    --included-files="services/${DIR_NAME}/**" \
    --substitutions="${SUBS}" \
    --service-account="projects/${PROJECT_ID}/serviceAccounts/cicd-builder@${PROJECT_ID}.iam.gserviceaccount.com" \
    --quiet

  # Delete old trigger
  echo "  Deleting old trigger: $OLD_NAME"
  gcloud beta builds triggers delete "$OLD_NAME" --project="$PROJECT_ID" --quiet
done

# Now create the TEST triggers if they don't exist
for SERVICE in "${SERVICES[@]}"; do
  NEW_NAME="${SERVICE}-test-deploy"
  DIR_NAME="${SERVICE}_go"
  
  echo "🔄 Creating ${SERVICE} (test)..."
  
  SUBS="_DIR_NAME=${DIR_NAME},_DB_ID=${SERVICE}-test,_ENV_NAME=test,_ENV_SUFFIX=-test,_SERVICE_NAME=${SERVICE}"
  
  if [[ "$SERVICE" == "auth" ]]; then
    USERS_DB_ID="users-test"
    FIREBASE_KEY="AIzaSyCLDTIuGwoRcGLF1woXC6I1644-jSSXjNk"
    SUBS="${SUBS},_USERS_DB_ID=${USERS_DB_ID},_FIREBASE_WEB_API_KEY=${FIREBASE_KEY}"
  fi

  gcloud beta builds triggers create github \
    --name="$NEW_NAME" \
    --project="$PROJECT_ID" \
    --repo-name="tavern_swiper" \
    --repo-owner="pszaflarski" \
    --branch-pattern="^test$" \
    --build-config="services/${DIR_NAME}/cloudbuild.yaml" \
    --included-files="services/${DIR_NAME}/**" \
    --substitutions="${SUBS}" \
    --service-account="projects/${PROJECT_ID}/serviceAccounts/cicd-builder@${PROJECT_ID}.iam.gserviceaccount.com" \
    --quiet
done
