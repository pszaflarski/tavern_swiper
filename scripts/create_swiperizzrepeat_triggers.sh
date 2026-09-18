#!/bin/bash
# scripts/create_swiperizzrepeat_triggers.sh
# Creates Cloud Build triggers for swiperizzrepeat-dev watching the 'development' branch.

set -e

PROJECT_ID="swiperizzrepeat-dev"
ENV_NAME="dev"
ENV_SUFFIX="-dev"
BRANCH_PATTERN="^development$"
REPO_OWNER="pszaflarski"
REPO_NAME="swiperizzrepeat"
BUILDER_SA="projects/$PROJECT_ID/serviceAccounts/cicd-builder@$PROJECT_ID.iam.gserviceaccount.com"

# Fetch JWT_SECRET from Secret Manager if not set
if [[ -z "$JWT_SECRET" ]]; then
  echo "Fetching JWT_SECRET from Secret Manager in $PROJECT_ID..."
  JWT_SECRET=$(gcloud secrets versions access latest --secret=jwt-secret --project="$PROJECT_ID" 2>/dev/null || echo "")
  if [[ -z "$JWT_SECRET" ]]; then
    echo "⚠️ Warning: jwt-secret not found in Secret Manager. Using fallback placeholder."
    JWT_SECRET="temporary-jwt-secret-change-me"
  fi
fi

# Firebase Web App keys (fallback to placeholders if not yet generated)
FIREBASE_KEY="${FIREBASE_KEY:-AIzaSy-PLACEHOLDER-KEY}"
FIREBASE_SENDER_ID="${FIREBASE_SENDER_ID:-1234567890}"
FIREBASE_APP_ID="${FIREBASE_APP_ID:-1:1234567890:web:abcdef}"

KMS_KEY_NAME="projects/$PROJECT_ID/locations/us-central1/keyRings/bots-keyring/cryptoKeys/bots-key"

echo "🚀 Creating Cloud Build triggers for $PROJECT_ID watching '$BRANCH_PATTERN'..."

create_backend_trigger() {
    local name=$1
    local yaml=$2
    local included_path=$3
    local dir_name=$4
    local service=$5
    local extra_subs=$6

    echo "--- Trigger: $name ---"
    # Check if trigger already exists
    local trigger_id
    trigger_id=$(gcloud beta builds triggers list --project="$PROJECT_ID" --filter="name=$name" --format="value(id)" 2>/dev/null || true)
    if [[ -n "$trigger_id" ]]; then
        echo "✅ Trigger $name already exists (ID: $trigger_id), deleting and recreating for update..."
        gcloud beta builds triggers delete "$name" --project="$PROJECT_ID" --quiet
    fi

    local subs="_ENV_NAME=$ENV_NAME,_ENV_SUFFIX=$ENV_SUFFIX,_DIR_NAME=$dir_name,_SERVICE_NAME=$service"
    if [[ -n "$extra_subs" ]]; then
        subs="$subs,$extra_subs"
    fi

    gcloud beta builds triggers create github \
        --project="$PROJECT_ID" \
        --name="$name" \
        --repo-owner="$REPO_OWNER" \
        --repo-name="$REPO_NAME" \
        --branch-pattern="$BRANCH_PATTERN" \
        --build-config="$yaml" \
        --included-files="$included_path/**" \
        --service-account="$BUILDER_SA" \
        --substitutions="$subs" \
        --quiet
    echo "✅ Created $name"
}

create_frontend_trigger() {
    local name=$1
    local yaml=$2
    local included_path=$3
    local service=$4
    local extra_subs=$5

    echo "--- Trigger: $name ---"
    local trigger_id
    trigger_id=$(gcloud beta builds triggers list --project="$PROJECT_ID" --filter="name=$name" --format="value(id)" 2>/dev/null || true)
    if [[ -n "$trigger_id" ]]; then
        echo "✅ Trigger $name already exists (ID: $trigger_id), deleting and recreating for update..."
        gcloud beta builds triggers delete "$name" --project="$PROJECT_ID" --quiet
    fi

    local subs="_ENV_NAME=$ENV_NAME,_ENV_SUFFIX=$ENV_SUFFIX,_SERVICE_NAME=$service"
    if [[ -n "$extra_subs" ]]; then
        subs="$subs,$extra_subs"
    fi

    gcloud beta builds triggers create github \
        --project="$PROJECT_ID" \
        --name="$name" \
        --repo-owner="$REPO_OWNER" \
        --repo-name="$REPO_NAME" \
        --branch-pattern="$BRANCH_PATTERN" \
        --build-config="$yaml" \
        --included-files="$included_path/**" \
        --service-account="$BUILDER_SA" \
        --substitutions="$subs" \
        --quiet
    echo "✅ Created $name"
}

# 1. Router
create_backend_trigger "router-dev-deploy" \
    "services/router/router_go/cloudbuild.yaml" "services/router/router_go" "router_go" "router" \
    "_DB_ID=router-$ENV_NAME,_JWT_SECRET=$JWT_SECRET"

# 2. Auth
create_backend_trigger "auth-dev-deploy" \
    "services/auth/auth_go/cloudbuild.yaml" "services/auth/auth_go" "auth_go" "auth" \
    "_DB_ID=auth-$ENV_NAME,_USERS_DB_ID=users-$ENV_NAME,_FIREBASE_WEB_API_KEY=$FIREBASE_KEY,_JWT_SECRET=$JWT_SECRET"

# 3. Users
create_backend_trigger "users-dev-deploy" \
    "services/auth/users_go/cloudbuild.yaml" "services/auth/users_go" "users_go" "users" \
    "_DB_ID=users-$ENV_NAME,_JWT_SECRET=$JWT_SECRET"

# 4. Profiles
create_backend_trigger "profiles-dev-deploy" \
    "services/profiles/profiles_go/cloudbuild.yaml" "services/profiles/profiles_go" "profiles_go" "profiles" \
    "_DB_ID=profiles-$ENV_NAME,_JWT_SECRET=$JWT_SECRET"

# 5. Discovery
create_backend_trigger "discovery-dev-deploy" \
    "services/discovery/discovery_go/cloudbuild.yaml" "services/discovery/discovery_go" "discovery_go" "discovery" \
    "_DB_ID=discovery-$ENV_NAME,_JWT_SECRET=$JWT_SECRET"

# 6. Discovery Subscriber
create_backend_trigger "discovery-subscriber-dev-deploy" \
    "services/discovery/discovery_subscriber/cloudbuild.yaml" "services/discovery/discovery_subscriber" "discovery_subscriber" "discovery-subscriber" \
    "_DB_ID=discovery-$ENV_NAME"

# 7. Discovery Worker
create_backend_trigger "discovery-worker-dev-deploy" \
    "services/discovery/discovery_worker/cloudbuild.yaml" "services/discovery/discovery_worker" "discovery_worker" "discovery-worker" \
    "_DB_ID=discovery-$ENV_NAME"

# 8. Messages
create_backend_trigger "messages-dev-deploy" \
    "services/messages/messages_go/cloudbuild.yaml" "services/messages/messages_go" "messages_go" "messages" \
    "_DB_ID=messages-$ENV_NAME,_JWT_SECRET=$JWT_SECRET"

# 9. Messages Subscriber
create_backend_trigger "messages-subscriber-dev-deploy" \
    "services/messages/messages_subscriber/cloudbuild.yaml" "services/messages/messages_subscriber" "messages_subscriber" "messages-subscriber" \
    "_DB_ID=messages-$ENV_NAME"

# 10. Bots
create_backend_trigger "bots-dev-deploy" \
    "services/bots/bots_go/cloudbuild.yaml" "services/bots/bots_go" "bots_go" "bots" \
    "_DB_ID=bots-$ENV_NAME,_JWT_SECRET=$JWT_SECRET,_KMS_KEY_NAME=$KMS_KEY_NAME"

# 11. Bots Subscriber
create_backend_trigger "bots-subscriber-dev-deploy" \
    "services/bots/bots_subscriber/cloudbuild.yaml" "services/bots/bots_subscriber" "bots_subscriber" "bots_subscriber" \
    "_DB_ID=bots-$ENV_NAME,_JWT_SECRET=$JWT_SECRET"

# 12. Quests
create_backend_trigger "quests-dev-deploy" \
    "services/quests/quests_go/cloudbuild.yaml" "services/quests/quests_go" "quests_go" "quests" \
    "_DB_ID=quests-$ENV_NAME,_JWT_SECRET=$JWT_SECRET"

# 13. Characters
create_backend_trigger "characters-dev-deploy" \
    "services/characters/characters_go/cloudbuild.yaml" "services/characters/characters_go" "characters_go" "characters" \
    "_DB_ID=characters-$ENV_NAME,_JWT_SECRET=$JWT_SECRET"

# 14. Notifications
create_backend_trigger "notifications-dev-deploy" \
    "services/notifications/notifications_go/cloudbuild.yaml" "services/notifications/notifications_go" "notifications_go" "notifications" \
    "_DB_ID=notifications-$ENV_NAME,_JWT_SECRET=$JWT_SECRET"

# 15. Notifications Subscriber
create_backend_trigger "notifications-subscriber-dev-deploy" \
    "services/notifications/notifications_subscriber/cloudbuild.yaml" "services/notifications/notifications_subscriber" "notifications_subscriber" "notifications-subscriber" \
    "_DB_ID=notifications-$ENV_NAME,_JWT_SECRET=$JWT_SECRET"

# 16. Frontend
create_frontend_trigger "frontend-dev-deploy" \
    "frontend/cloudbuild.yaml" "frontend" "app" \
    "_FIREBASE_API_KEY=$FIREBASE_KEY,_FIREBASE_MESSAGING_SENDER_ID=$FIREBASE_SENDER_ID,_FIREBASE_APP_ID=$FIREBASE_APP_ID"

echo "--------------------------------------------------------"
echo "🎉 All Cloud Build triggers created for $PROJECT_ID watching '$BRANCH_PATTERN'!"
