#!/bin/bash
# scripts/bootstrap_swiperizzrepeat.sh
# Bootstrap script for Tavern Swiper in swiperizzrepeat-dev

set -e

PROJECT="swiperizzrepeat-dev"
ENV="dev"
REGION="us-central1"

echo "🚀 Bootstrapping Tavern Swiper for project: '$PROJECT' (env: '$ENV', region: '$REGION')"
echo "--------------------------------------------------------"

# 1. Set active project
echo "🔄 Setting active gcloud project to $PROJECT..."
gcloud config set project "$PROJECT"

# 2. Enable Required APIs
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
  cloudkms.googleapis.com \
  storage.googleapis.com \
  bigquery.googleapis.com \
  eventarc.googleapis.com \
  cloudscheduler.googleapis.com \
  --project="$PROJECT"

# 3. Service Accounts
echo "🔑 Provisioning Service Accounts..."
SA_EMAIL="tavern-swiper-sa@${PROJECT}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" &>/dev/null; then
  echo "✅ Service Account tavern-swiper-sa already exists."
else
  gcloud iam service-accounts create tavern-swiper-sa \
    --description="Main runtime service account for Tavern Swiper microservices" \
    --display-name="Tavern Swiper SA" \
    --project="$PROJECT"
fi

BUILDER_SA="cicd-builder@${PROJECT}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$BUILDER_SA" --project="$PROJECT" &>/dev/null; then
  echo "✅ Service Account cicd-builder already exists."
else
  gcloud iam service-accounts create cicd-builder \
    --description="CI/CD builder service account for Cloud Build" \
    --display-name="CI/CD Builder" \
    --project="$PROJECT"
fi

# 4. IAM Bindings
echo "🛡️  Binding IAM Roles to tavern-swiper-sa..."
RUNTIME_ROLES=(
  "roles/datastore.user"
  "roles/pubsub.publisher"
  "roles/pubsub.subscriber"
  "roles/secretmanager.secretAccessor"
  "roles/storage.objectAdmin"
  "roles/bigquery.dataEditor"
  "roles/bigquery.user"
  "roles/run.invoker"
  "roles/eventarc.eventReceiver"
  "roles/cloudkms.cryptoKeyEncrypterDecrypter"
)

for ROLE in "${RUNTIME_ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" \
    --condition=None \
    --quiet
done

echo "🛡️  Binding IAM Roles to cicd-builder..."
BUILDER_ROLES=(
  "roles/cloudbuild.builds.builder"
  "roles/run.admin"
  "roles/iam.serviceAccountUser"
  "roles/artifactregistry.admin"
  "roles/secretmanager.secretAccessor"
  "roles/storage.admin"
)

for ROLE in "${BUILDER_ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${BUILDER_SA}" \
    --role="$ROLE" \
    --condition=None \
    --quiet
done

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")
CLOUDBUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Allow Cloud Build SA to act as runtime SA
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None \
  --project="$PROJECT" \
  --quiet

# Allow Cloud Build SA to act as cicd-builder
gcloud iam service-accounts add-iam-policy-binding "${BUILDER_SA}" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None \
  --project="$PROJECT" \
  --quiet

# Pub/Sub SA Token Creator permission for OIDC push subscriptions
PUBSUB_SA="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --member="serviceAccount:${PUBSUB_SA}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="$PROJECT" \
  --quiet &>/dev/null || true

# 5. Cloud KMS
echo "🔐 Setting up Cloud KMS for Bots Service..."
if gcloud kms keyrings describe bots-keyring --location="$REGION" --project="$PROJECT" &>/dev/null; then
  echo "✅ KMS Keyring bots-keyring already exists."
else
  gcloud kms keyrings create bots-keyring --location="$REGION" --project="$PROJECT"
fi

if gcloud kms keys describe bots-key --keyring=bots-keyring --location="$REGION" --project="$PROJECT" &>/dev/null; then
  echo "✅ KMS Key bots-key already exists."
else
  gcloud kms keys create bots-key \
    --keyring=bots-keyring \
    --location="$REGION" \
    --purpose=encryption \
    --project="$PROJECT"
fi

# 6. Secret Manager
echo "🔐 Provisioning Secret Manager Secrets..."
if gcloud secrets describe jwt-secret --project="$PROJECT" &>/dev/null; then
  echo "✅ Secret jwt-secret already exists."
else
  echo "Generating fresh 32-byte JWT secret..."
  NEW_JWT_SECRET=$(openssl rand -base64 32)
  gcloud secrets create jwt-secret --replication-policy="automatic" --project="$PROJECT"
  echo -n "$NEW_JWT_SECRET" | gcloud secrets versions add jwt-secret --data-file=- --project="$PROJECT"
  echo "✅ Secret jwt-secret created."
fi

# MongoDB placeholder for agent router
for MONGO_SEC in "agent-router-mongodb-${ENV}" "MONGODB_URI"; do
  if gcloud secrets describe "$MONGO_SEC" --project="$PROJECT" &>/dev/null; then
    echo "✅ Secret $MONGO_SEC already exists."
  else
    gcloud secrets create "$MONGO_SEC" --replication-policy="automatic" --project="$PROJECT"
    echo -n "mongodb://placeholder" | gcloud secrets versions add "$MONGO_SEC" --data-file=- --project="$PROJECT"
    echo "⚠️ Created placeholder for $MONGO_SEC."
  fi
done

# 7. Cloud Storage Buckets (Public Read for Avatars)
echo "📦 Creating Cloud Storage Buckets..."
BUCKETS=("${PROJECT}-media-${ENV}" "${PROJECT}-characters-media-${ENV}")
for BUCKET in "${BUCKETS[@]}"; do
  if gcloud storage buckets describe "gs://$BUCKET" --project="$PROJECT" &>/dev/null; then
    echo "✅ Bucket $BUCKET already exists."
  else
    gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --project="$PROJECT"
  fi
  # Ensure public read policy
  echo "Ensuring public read access on gs://$BUCKET..."
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
    --member="allUsers" \
    --role="roles/storage.objectViewer" \
    --project="$PROJECT" \
    --quiet &>/dev/null || true
done

# 8. Pub/Sub Topics
echo "📡 Creating Pub/Sub Topics..."
TOPICS=(
  "${ENV}-profiles-profile-events-v1"
  "${ENV}-discovery-match-events-v1"
  "${ENV}-messages-message-events-v1"
  "${ENV}-bots-agent-request-v1"
  "${ENV}-agent-router-agent-response-v1"
  "${ENV}-agent-router-memory-events-v1"
)
for TOPIC in "${TOPICS[@]}"; do
  if gcloud pubsub topics describe "$TOPIC" --project="$PROJECT" &>/dev/null; then
    echo "✅ Topic $TOPIC already exists."
  else
    gcloud pubsub topics create "$TOPIC" --project="$PROJECT"
  fi
done

# 9. Firestore Enterprise Databases
echo "🗄️  Setting up Firestore Enterprise Databases..."
# Delete default DB if it exists so discovery-dev can claim free tier
if gcloud firestore databases describe --database="(default)" --project="$PROJECT" &>/dev/null; then
  echo "Deleting auto-generated (default) database to grant free tier to discovery-dev..."
  gcloud firestore databases delete --database="(default)" --project="$PROJECT" --quiet || true
fi

# discovery-dev first (free tier)
DATABASES=("discovery" "users" "profiles" "messages" "router" "quests" "bots" "characters" "notifications")
for DB_BASE in "${DATABASES[@]}"; do
  DB_ID="${DB_BASE}-${ENV}"
  if gcloud firestore databases describe --database="$DB_ID" --project="$PROJECT" &>/dev/null; then
    echo "✅ Database $DB_ID already exists."
  else
    echo "🏗️  Creating database $DB_ID..."
    gcloud firestore databases create --database="$DB_ID" \
      --location="$REGION" \
      --type=firestore-native \
      --edition=enterprise \
      --enable-firestore-data-access \
      --enable-realtime-updates \
      --project="$PROJECT" \
      --quiet
  fi
done

# 10. Apply Indexes
echo "🗂️  Applying Firestore Indexes..."
bash "$(dirname "$0")/apply-indexes.sh" "$ENV" "$PROJECT"

echo "--------------------------------------------------------"
echo "🎉 Bootstrap completed for $PROJECT!"
