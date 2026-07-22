#!/bin/bash
# scripts/create_bq_cdc_triggers.sh
# Automates creation of Eventarc triggers for Firestore-to-BigQuery CDC.

set -e

ENV=$1
if [[ -z "$ENV" ]]; then
  echo "Usage: ./scripts/create_bq_cdc_triggers.sh [dev|test|prod]"
  exit 1
fi

if [[ "$ENV" == "prod" ]]; then
  PROJECT="tavern-swiper-prod"
  LOCATION="nam5"
  DEST_REGION="--destination-run-region=us-central1"
  echo "⚠️ WARNING: This command will modify the PRODUCTION environment."
else
  PROJECT="tavern-swiper-dev"
  LOCATION="us-central1"
  DEST_REGION=""
fi

echo "🚀 Provisioning Eventarc CDC triggers for environment: $ENV"
echo "📍 Location/Region: $LOCATION"
echo "🆔 Project: $PROJECT"

SA_EMAIL="tavern-swiper-sa@${PROJECT}.iam.gserviceaccount.com"

# Trigger 1: Profiles
TRIGGER_PROFILES="profiles-bq-cdc-${ENV}"
if gcloud eventarc triggers describe "$TRIGGER_PROFILES" --location="$LOCATION" --project="$PROJECT" &>/dev/null; then
  echo "✅ Eventarc trigger $TRIGGER_PROFILES already exists."
else
  echo "🏗️ Creating Eventarc trigger $TRIGGER_PROFILES..."
  gcloud eventarc triggers create "$TRIGGER_PROFILES" \
    --project="$PROJECT" \
    --location="$LOCATION" \
    --destination-run-service="profiles-analytics-${ENV}" \
    $DEST_REGION \
    --destination-run-path="/" \
    --event-filters="type=google.cloud.firestore.document.v1.written" \
    --event-filters="database=profiles-${ENV}" \
    --event-filters-path-pattern="document=profiles/{profile_id}" \
    --event-data-content-type="application/protobuf" \
    --service-account="$SA_EMAIL" \
    --quiet
  echo "✅ Trigger $TRIGGER_PROFILES created."
fi

# Trigger 2: Matches (Discovery)
TRIGGER_MATCHES="matches-bq-cdc-${ENV}"
if gcloud eventarc triggers describe "$TRIGGER_MATCHES" --location="$LOCATION" --project="$PROJECT" &>/dev/null; then
  echo "✅ Eventarc trigger $TRIGGER_MATCHES already exists."
else
  echo "🏗️ Creating Eventarc trigger $TRIGGER_MATCHES..."
  gcloud eventarc triggers create "$TRIGGER_MATCHES" \
    --project="$PROJECT" \
    --location="$LOCATION" \
    --destination-run-service="discovery-analytics-${ENV}" \
    $DEST_REGION \
    --destination-run-path="/" \
    --event-filters="type=google.cloud.firestore.document.v1.written" \
    --event-filters="database=discovery-${ENV}" \
    --event-filters-path-pattern="document=matches/{match_id}" \
    --event-data-content-type="application/protobuf" \
    --service-account="$SA_EMAIL" \
    --quiet
  echo "✅ Trigger $TRIGGER_MATCHES created."
fi

# Trigger 3: Matches Cache (Messages DB)
TRIGGER_MESSAGES_MATCHES="messages-matches-bq-cdc-${ENV}"
if gcloud eventarc triggers describe "$TRIGGER_MESSAGES_MATCHES" --location="$LOCATION" --project="$PROJECT" &>/dev/null; then
  echo "✅ Eventarc trigger $TRIGGER_MESSAGES_MATCHES already exists."
else
  echo "🏗️ Creating Eventarc trigger $TRIGGER_MESSAGES_MATCHES..."
  gcloud eventarc triggers create "$TRIGGER_MESSAGES_MATCHES" \
    --project="$PROJECT" \
    --location="$LOCATION" \
    --destination-run-service="messages-analytics-${ENV}" \
    $DEST_REGION \
    --destination-run-path="/" \
    --event-filters="type=google.cloud.firestore.document.v1.written" \
    --event-filters="database=messages-${ENV}" \
    --event-filters-path-pattern="document=discovery_matches_cache/{match_id}" \
    --event-data-content-type="application/protobuf" \
    --service-account="$SA_EMAIL" \
    --quiet
  echo "✅ Trigger $TRIGGER_MESSAGES_MATCHES created."
fi

# Trigger 4: Users (Users DB)
TRIGGER_USERS="users-bq-cdc-${ENV}"
if gcloud eventarc triggers describe "$TRIGGER_USERS" --location="$LOCATION" --project="$PROJECT" &>/dev/null; then
  echo "✅ Eventarc trigger $TRIGGER_USERS already exists."
else
  echo "🏗️ Creating Eventarc trigger $TRIGGER_USERS..."
  gcloud eventarc triggers create "$TRIGGER_USERS" \
    --project="$PROJECT" \
    --location="$LOCATION" \
    --destination-run-service="users-analytics-${ENV}" \
    $DEST_REGION \
    --destination-run-path="/" \
    --event-filters="type=google.cloud.firestore.document.v1.written" \
    --event-filters="database=users-${ENV}" \
    --event-filters-path-pattern="document=users/{user_id}" \
    --event-data-content-type="application/protobuf" \
    --service-account="$SA_EMAIL" \
    --quiet
  echo "✅ Trigger $TRIGGER_USERS created."
fi

# Trigger 5: Profiles Cache (Discovery DB)
TRIGGER_DISCOVERY_PROFILES="discovery-profiles-cache-bq-cdc-${ENV}"
if gcloud eventarc triggers describe "$TRIGGER_DISCOVERY_PROFILES" --location="$LOCATION" --project="$PROJECT" &>/dev/null; then
  echo "✅ Eventarc trigger $TRIGGER_DISCOVERY_PROFILES already exists."
else
  echo "🏗️ Creating Eventarc trigger $TRIGGER_DISCOVERY_PROFILES..."
  gcloud eventarc triggers create "$TRIGGER_DISCOVERY_PROFILES" \
    --project="$PROJECT" \
    --location="$LOCATION" \
    --destination-run-service="discovery-analytics-${ENV}" \
    $DEST_REGION \
    --destination-run-path="/" \
    --event-filters="type=google.cloud.firestore.document.v1.written" \
    --event-filters="database=discovery-${ENV}" \
    --event-filters-path-pattern="document=profiles_profiles_cache/{profile_id}" \
    --event-data-content-type="application/protobuf" \
    --service-account="$SA_EMAIL" \
    --quiet
  echo "✅ Trigger $TRIGGER_DISCOVERY_PROFILES created."
fi

echo "🏁 Eventarc triggers setup complete for $ENV!"
