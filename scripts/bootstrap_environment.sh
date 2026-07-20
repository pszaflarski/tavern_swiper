#!/bin/bash
# scripts/bootstrap_environment.sh
# Automates the bootstrapping of a Firebase/GCP environment for Tavern Swiper.

set -e

ENV=$1
PROJECT=$2

if [[ -z "$ENV" ]] || [[ -z "$PROJECT" ]]; then
  echo "Usage: ./scripts/bootstrap_environment.sh [dev|test|prod] [project_id]"
  echo "Example: ./scripts/bootstrap_environment.sh dev tavern-swiper-dev-v2"
  exit 1
fi

echo "🚀 Bootstrapping Firebase-first environment '$ENV' for project '$PROJECT'"
read -p "Are you sure you want to proceed? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "Aborting."
    exit 1
fi

echo "🔥 Initializing Firebase Project..."
# Ensure the user has the firebase CLI installed and is logged in.
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI not found. Please run 'npm install -g firebase-tools' first."
    exit 1
fi

# Attempt to add the Firebase project
# This assumes the underlying GCP project may or may not exist. If it doesn't,
# firebase projects:create will provision both the GCP project and Firebase resources.
if firebase projects:list | grep -q "$PROJECT"; then
    echo "✅ Firebase project $PROJECT already exists."
else
    echo "Checking if GCP project $PROJECT already exists..."
    if gcloud projects describe "$PROJECT" &>/dev/null; then
        echo "GCP project exists. Adding Firebase to it..."
        firebase projects:addfirebase "$PROJECT"
    else
        echo "Creating new GCP and Firebase project..."
        # Warning: this requires interactive login if not authenticated as a service account,
        # but works perfectly in environments where 'firebase login' has been run.
        firebase projects:create "$PROJECT" --display-name "Tavern Swiper $ENV"
    fi
fi

# Set the active gcloud project to match the newly created/verified Firebase project
echo "🔄 Setting active gcloud project to $PROJECT..."
gcloud config set project "$PROJECT"

echo "🛠️  Enabling Required GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  pubsub.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  artifactregistry.googleapis.com \
  containerregistry.googleapis.com \
  bigquery.googleapis.com \
  eventarc.googleapis.com \
  cloudscheduler.googleapis.com

echo "🔑 Creating Service Account 'tavern-swiper-sa'..."
SA_EMAIL="tavern-swiper-sa@${PROJECT}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$SA_EMAIL" &>/dev/null; then
  echo "✅ Service Account already exists."
else
  gcloud iam service-accounts create tavern-swiper-sa \
    --description="Main service account for Tavern Swiper microservices" \
    --display-name="Tavern Swiper SA"
fi

echo "🛡️  Binding IAM Roles to Service Account..."
ROLES=(
  "roles/datastore.user"
  "roles/pubsub.publisher"
  "roles/pubsub.subscriber"
  "roles/secretmanager.secretAccessor"
  "roles/storage.objectAdmin"
  "roles/bigquery.dataEditor"
  "roles/bigquery.user"
  "roles/run.invoker"
  "roles/eventarc.eventReceiver"
)

for ROLE in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" \
    --condition=None \
    --quiet
done

echo "🛡️  Setting up Cloud Build Service Account permissions..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Grant Cloud Build SA the ability to impersonate our runtime SA
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None \
  --quiet

echo "🔐 Provisioning Secret Manager Secrets..."
SECRETS=("MONGODB_URI")
for SECRET in "${SECRETS[@]}"; do
  if gcloud secrets describe "$SECRET" &>/dev/null; then
    echo "✅ Secret $SECRET already exists."
  else
    echo "Creating secret $SECRET..."
    gcloud secrets create "$SECRET" --replication-policy="automatic"
    echo "dummy-value" | gcloud secrets versions add "$SECRET" --data-file=-
    echo "⚠️  Created placeholder for $SECRET. Update it in the GCP Console!"
  fi
done

echo "🗄️  Setting up Databases..."
bash "$(dirname "$0")/setup-databases.sh" "$ENV"

echo "📡 Creating Pub/Sub Topics..."
TOPICS=(
  "${ENV}-profiles-profile-events-v1"
  "${ENV}-discovery-match-events-v1"
  "${ENV}-messages-message-events-v1"
)
for TOPIC in "${TOPICS[@]}"; do
  if gcloud pubsub topics describe "$TOPIC" &>/dev/null; then
    echo "✅ Topic $TOPIC already exists."
  else
    gcloud pubsub topics create "$TOPIC"
  fi
done

echo "📦 Creating Cloud Storage Bucket..."
BUCKET_NAME="${PROJECT}-media-${ENV}"
if gcloud storage buckets describe "gs://$BUCKET_NAME" &>/dev/null; then
  echo "✅ Bucket $BUCKET_NAME already exists."
else
  # Using standard location based on dev/prod split observed in setup-databases
  REGION="us-central1"
  if [[ "$ENV" == "prod" ]]; then
    REGION="us"
  fi
  gcloud storage buckets create "gs://$BUCKET_NAME" --location="$REGION" --uniform-bucket-level-access
fi

echo "🎉 Bootstrap complete!"
echo "--------------------------------------------------------"
echo "👉 NEXT STEPS:"
echo "1. Log into the Firebase Console: https://console.firebase.google.com/project/${PROJECT}/overview"
echo "2. Add a 'Web App' to the project to generate your Web API Key."
echo "3. Add the Web API Key to your frontend/.env file and auth_go/.env file."
echo "4. Copy .env.example to .env for all services and fill in details."
echo "5. Set up Cloud Build triggers (see infra/README.md)."
