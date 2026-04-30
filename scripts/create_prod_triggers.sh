#!/bin/bash
PROJECT_ID="tavern-swiper-prod"
REPO_OWNER="pszaflarski"
REPO_NAME="tavern_swiper"
JWT_SECRET="ofPjAHbf1C2otI/rpoA5SUjom0wd0qcNGlG0bv5G2sI="
FIREBASE_KEY="AIzaSyAe4-eeKUvy1SBYSFzHO5f92Cu1HuBPonI"
FIREBASE_SENDER_ID="43551826902"
FIREBASE_APP_ID="1:43551826902:web:a6dd705d465b60447bba77"

# Function to create a backend service trigger
# $1=name, $2=yaml, $3=included_files_path, $4=dir_name, $5=service_name, $6=extra_subs
create_backend_trigger() {
    local name=$1
    local yaml=$2
    local included_path=$3
    local dir_name=$4
    local service=$5
    local extra_subs=$6

    echo "Creating trigger: $name..."
    gcloud beta builds triggers create github \
        --project="$PROJECT_ID" \
        --name="$name" \
        --repo-owner="$REPO_OWNER" \
        --repo-name="$REPO_NAME" \
        --branch-pattern="^prod$" \
        --build-config="$yaml" \
        --included-files="$included_path/**" \
        --service-account="projects/$PROJECT_ID/serviceAccounts/cicd-builder@$PROJECT_ID.iam.gserviceaccount.com" \
        --substitutions="_ENV_NAME=prod,_ENV_SUFFIX=-prod,_DIR_NAME=$dir_name,_SERVICE_NAME=$service,$extra_subs"
}

# Function to create the frontend trigger (no _DIR_NAME, matches dev trigger)
create_frontend_trigger() {
    local name=$1
    local yaml=$2
    local included_path=$3
    local service=$4
    local extra_subs=$5

    echo "Creating trigger: $name..."
    gcloud beta builds triggers create github \
        --project="$PROJECT_ID" \
        --name="$name" \
        --repo-owner="$REPO_OWNER" \
        --repo-name="$REPO_NAME" \
        --branch-pattern="^prod$" \
        --build-config="$yaml" \
        --included-files="$included_path/**" \
        --service-account="projects/$PROJECT_ID/serviceAccounts/cicd-builder@$PROJECT_ID.iam.gserviceaccount.com" \
        --substitutions="_ENV_NAME=prod,_ENV_SUFFIX=-prod,_SERVICE_NAME=$service,$extra_subs"
}

# 1. Auth
create_backend_trigger "auth-prod-deploy" \
    "services/auth_go/cloudbuild.yaml" "services/auth_go" "auth_go" "auth" \
    "_DB_ID=auth-prod,_USERS_DB_ID=users-prod,_FIREBASE_WEB_API_KEY=$FIREBASE_KEY,_JWT_SECRET=$JWT_SECRET"

# 2. Users
create_backend_trigger "users-prod-deploy" \
    "services/users_go/cloudbuild.yaml" "services/users_go" "users_go" "users" \
    "_DB_ID=users-prod,_JWT_SECRET=$JWT_SECRET"

# 3. Profiles
create_backend_trigger "profiles-prod-deploy" \
    "services/profiles_go/cloudbuild.yaml" "services/profiles_go" "profiles_go" "profiles" \
    "_DB_ID=profiles-prod,_JWT_SECRET=$JWT_SECRET"

# 4. Discovery
create_backend_trigger "discovery-prod-deploy" \
    "services/discovery_go/cloudbuild.yaml" "services/discovery_go" "discovery_go" "discovery" \
    "_DB_ID=discovery-prod,_JWT_SECRET=$JWT_SECRET"

# 5. Messages
create_backend_trigger "messages-prod-deploy" \
    "services/messages_go/cloudbuild.yaml" "services/messages_go" "messages_go" "messages" \
    "_DB_ID=messages-prod,_JWT_SECRET=$JWT_SECRET"

# 6. Discovery Subscriber
create_backend_trigger "discovery-subscriber-prod-deploy" \
    "services/discovery_subscriber/cloudbuild.yaml" "services/discovery_subscriber" "discovery_subscriber" "discovery-subscriber" \
    "_DB_ID=discovery-prod"

# 7. Messages Subscriber
create_backend_trigger "messages-subscriber-prod-deploy" \
    "services/messages_subscriber/cloudbuild.yaml" "services/messages_subscriber" "messages_subscriber" "messages-subscriber" \
    "_DB_ID=messages-prod"

# 8. Frontend (no _DIR_NAME — matches dev trigger structure)
create_frontend_trigger "frontend-prod-deploy" \
    "frontend/cloudbuild.yaml" "frontend" "app" \
    "_FIREBASE_API_KEY=$FIREBASE_KEY,_FIREBASE_MESSAGING_SENDER_ID=$FIREBASE_SENDER_ID,_FIREBASE_APP_ID=$FIREBASE_APP_ID"

echo "✅ All production triggers created!"
