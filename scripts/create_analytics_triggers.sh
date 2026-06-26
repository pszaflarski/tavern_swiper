#!/bin/bash
# scripts/create_analytics_triggers.sh
# Creates Cloud Build triggers for the profiles_analytics and discovery_analytics services.

set -e

ENV=$1
if [[ -z "$ENV" ]]; then
  echo "Usage: ./scripts/create_analytics_triggers.sh [dev|test|prod]"
  exit 1
fi

PROJECT="tavern-swiper-dev"
if [[ "$ENV" == "prod" ]]; then
  PROJECT="tavern-swiper-prod"
  echo "⚠️ WARNING: This command will modify the PRODUCTION environment."
  read -p "Are you sure you want to proceed with Prod triggers? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborting."
      exit 1
  fi
fi

REPO_OWNER="pszaflarski"
REPO_NAME="tavern_swiper"
BRANCH="^${ENV}$"

echo "🚀 Creating Cloud Build triggers for environment: $ENV"
echo "🆔 Project: $PROJECT"

create_trigger() {
    local name=$1
    local yaml=$2
    local included_path=$3
    local dir_name=$4
    local service=$5

    echo "Creating trigger: $name..."
    # Check if trigger already exists
    TRIGGER_ID=$(gcloud builds triggers list --project="$PROJECT" --filter="name=$name" --format="value(id)" 2>/dev/null || echo "")
    if [[ -n "$TRIGGER_ID" ]]; then
        echo "✅ Trigger $name already exists (ID: $TRIGGER_ID), skipping."
    else
        gcloud beta builds triggers create github \
            --project="$PROJECT" \
            --name="$name" \
            --repo-owner="$REPO_OWNER" \
            --repo-name="$REPO_NAME" \
            --branch-pattern="$BRANCH" \
            --build-config="$yaml" \
            --included-files="$included_path/**" \
            --service-account="projects/$PROJECT/serviceAccounts/cicd-builder@$PROJECT.iam.gserviceaccount.com" \
            --substitutions="_ENV_NAME=$ENV,_ENV_SUFFIX=-$ENV,_DIR_NAME=$dir_name,_SERVICE_NAME=$service" \
            --quiet
        echo "✅ Trigger $name created."
    fi
}

# 1. Profiles Analytics
create_trigger "profiles-analytics-${ENV}-deploy" \
    "services/profiles/profiles_analytics/cloudbuild.yaml" \
    "services/profiles/profiles_analytics" \
    "profiles_analytics" \
    "profiles-analytics"

# 2. Discovery Analytics
create_trigger "discovery-analytics-${ENV}-deploy" \
    "services/discovery/discovery_analytics/cloudbuild.yaml" \
    "services/discovery/discovery_analytics" \
    "discovery_analytics" \
    "discovery-analytics"

echo "🏁 All analytics triggers created for $ENV!"
