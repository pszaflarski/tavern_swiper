#!/bin/bash
# scripts/create_bq_cdc_triggers.sh
# Automates creation of Eventarc triggers for Firestore-to-BigQuery CDC.

set -e

ENV=$1
if [[ -z "$ENV" ]]; then
  echo "Usage: ./scripts/create_bq_cdc_triggers.sh [dev|test|prod]"
  exit 1
fi

PROJECT=$(gcloud config get-value project)
LOCATION="us-central1"

# Production uses nam5 for Firestore, so Eventarc trigger location is "us"
if [[ "$ENV" == "prod" ]]; then
  LOCATION="us"
  echo "⚠️ WARNING: This command will modify the PRODUCTION environment."
  read -p "Are you sure you want to proceed with Prod? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "Aborting."
      exit 1
  fi
fi

echo "🚀 Provisioning Eventarc CDC triggers for environment: $ENV"
echo "📍 Location/Region: $LOCATION"
echo "🆔 Project: $PROJECT"

SA_EMAIL="tavern-swiper-sa@${PROJECT}.iam.gserviceaccount.com"

# Trigger 1: Profiles
TRIGGER_PROFILES="profiles-bq-cdc-${ENV}"
if gcloud eventarc triggers describe "$TRIGGER_PROFILES" --location="$LOCATION" &>/dev/null; then
  echo "✅ Eventarc trigger $TRIGGER_PROFILES already exists."
else
  echo "🏗️ Creating Eventarc trigger $TRIGGER_PROFILES..."
  gcloud eventarc triggers create "$TRIGGER_PROFILES" \
    --location="$LOCATION" \
    --destination-run-service="profiles-analytics-${ENV}" \
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
if gcloud eventarc triggers describe "$TRIGGER_MATCHES" --location="$LOCATION" &>/dev/null; then
  echo "✅ Eventarc trigger $TRIGGER_MATCHES already exists."
else
  echo "🏗️ Creating Eventarc trigger $TRIGGER_MATCHES..."
  gcloud eventarc triggers create "$TRIGGER_MATCHES" \
    --location="$LOCATION" \
    --destination-run-service="discovery-analytics-${ENV}" \
    --destination-run-path="/" \
    --event-filters="type=google.cloud.firestore.document.v1.written" \
    --event-filters="database=discovery-${ENV}" \
    --event-filters-path-pattern="document=matches/{match_id}" \
    --event-data-content-type="application/protobuf" \
    --service-account="$SA_EMAIL" \
    --quiet
  echo "✅ Trigger $TRIGGER_MATCHES created."
fi

echo "🏁 Eventarc triggers setup complete for $ENV!"
