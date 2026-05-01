#!/bin/bash
# scripts/setup-databases.sh
# Creates Firestore Enterprise databases and applies indexes for a given environment.

set -e

ENV=$1
if [[ -z "$ENV" ]]; then
  echo "Usage: ./scripts/setup-databases.sh [dev|test|prod]"
  exit 1
fi

PROJECT=$(gcloud config get-value project)
REGION="us-central1"

# Production uses multi-region nam5
if [[ "$ENV" == "prod" ]]; then
  REGION="nam5"
fi

echo "🚀 Setting up Firestore Enterprise databases for: $ENV"
echo "📍 Region: $REGION"
echo "🆔 Project: $PROJECT"

DATABASES=("auth" "users" "profiles" "discovery" "messages")

for DB_BASE in "${DATABASES[@]}"; do
  DB_ID="${DB_BASE}-${ENV}"
  
  echo "--- Processing: $DB_ID ---"
  
  # Check if DB already exists
  if gcloud firestore databases describe --database="$DB_ID" &>/dev/null; then
    echo "✅ Database $DB_ID already exists."
  else
    echo "🏗️  Creating database $DB_ID..."
    gcloud firestore databases create --database="$DB_ID" \
      --location="$REGION" \
      --type=firestore-native \
      --edition=enterprise \
      --enable-firestore-data-access \
      --enable-realtime-updates \
      --quiet
  fi
done

echo "✨ All databases created/verified."
echo "🗂️  Applying indexes..."
bash "$(dirname "$0")/apply-indexes.sh" "$ENV"

echo "🏁 Setup complete for $ENV!"
