#!/usr/bin/env bash
set -e

ENV="${1:-dev}"
REGION="us-central1"

if [[ "$ENV" == "prod" ]]; then
  PROJECT_ID="tavern-swiper-prod"
else
  PROJECT_ID="tavern-swiper-dev"
fi

echo "📡 Setting up Pub/Sub Topics & Push Subscriptions for environment: ${ENV} (Project: ${PROJECT_ID})"

SA_EMAIL="tavern-swiper-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant Pub/Sub service account Token Creator role on SA_EMAIL for OIDC push subscriptions
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
echo "🔑 Ensuring Pub/Sub service account has Token Creator permissions..."
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="${PROJECT_ID}" --quiet &>/dev/null || true

# 1. Fetch Cloud Run service URLs
echo "🔍 Discovering Cloud Run service URLs..."
AGENT_ROUTER_URL=$(gcloud run services describe "agent-router-${ENV}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)' 2>/dev/null || true)
BOTS_SUBSCRIBER_URL=$(gcloud run services describe "bots-subscriber-${ENV}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)' 2>/dev/null || true)
DISCOVERY_SUBSCRIBER_URL=$(gcloud run services describe "discovery-subscriber-${ENV}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)' 2>/dev/null || true)
MESSAGES_SUBSCRIBER_URL=$(gcloud run services describe "messages-subscriber-${ENV}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)' 2>/dev/null || true)
NOTIFICATIONS_GO_URL=$(gcloud run services describe "notifications-go-${ENV}" --region="${REGION}" --project="${PROJECT_ID}" --format='value(status.url)' 2>/dev/null || true)

if [[ -z "$AGENT_ROUTER_URL" ]]; then
  echo "⚠️ Warning: Could not resolve URL for agent-router-${ENV}. Make sure Cloud Run service is deployed."
fi
if [[ -z "$BOTS_SUBSCRIBER_URL" ]]; then
  echo "⚠️ Warning: Could not resolve URL for bots-subscriber-${ENV}. Make sure Cloud Run service is deployed."
fi

# 2. Ensure Topics exist
TOPICS=(
  "${ENV}-profiles-profile-events-v1"
  "${ENV}-discovery-match-events-v1"
  "${ENV}-messages-message-events-v1"
  "${ENV}-bots-agent-request-v1"
  "${ENV}-agent-router-agent-response-v1"
)

echo "📦 Creating Topics..."
for TOPIC in "${TOPICS[@]}"; do
  if gcloud pubsub topics describe "$TOPIC" --project="${PROJECT_ID}" &>/dev/null; then
    echo "✅ Topic $TOPIC exists."
  else
    echo "🚀 Creating topic $TOPIC..."
    gcloud pubsub topics create "$TOPIC" --project="${PROJECT_ID}"
  fi
done

# Function to create or update push subscription
create_or_update_sub() {
  local SUB_NAME="$1"
  local TOPIC_NAME="$2"
  local PUSH_ENDPOINT="$3"
  local ACK_DEADLINE="$4"

  if [[ -z "$PUSH_ENDPOINT" ]]; then
    echo "⚠️ Skipping subscription $SUB_NAME: push endpoint URL is empty."
    return
  fi

  if gcloud pubsub subscriptions describe "$SUB_NAME" --project="${PROJECT_ID}" &>/dev/null; then
    echo "🔄 Updating existing subscription $SUB_NAME..."
    gcloud pubsub subscriptions update "$SUB_NAME" \
      --push-endpoint="$PUSH_ENDPOINT" \
      --ack-deadline="$ACK_DEADLINE" \
      --project="${PROJECT_ID}"
  else
    echo "🚀 Creating subscription $SUB_NAME..."
    gcloud pubsub subscriptions create "$SUB_NAME" \
      --topic="$TOPIC_NAME" \
      --push-endpoint="$PUSH_ENDPOINT" \
      --push-auth-service-account="$SA_EMAIL" \
      --ack-deadline="$ACK_DEADLINE" \
      --project="${PROJECT_ID}"
  fi
}

# 3. Create or update Push Subscriptions
echo "🔗 Setting up Push Subscriptions..."

# Agent Router subscriber (receives bot agent requests) - 600s ack deadline
if [[ -n "$AGENT_ROUTER_URL" ]]; then
  create_or_update_sub \
    "${ENV}-agent-router-request-push-sub" \
    "${ENV}-bots-agent-request-v1" \
    "${AGENT_ROUTER_URL}/pubsub/agent-request" \
    600
fi

# Bots subscriber (receives agent responses)
if [[ -n "$BOTS_SUBSCRIBER_URL" ]]; then
  create_or_update_sub \
    "${ENV}-bots-agent-response-push-sub" \
    "${ENV}-agent-router-agent-response-v1" \
    "${BOTS_SUBSCRIBER_URL}/" \
    60
fi

# Discovery subscriber (receives profile events)
if [[ -n "$DISCOVERY_SUBSCRIBER_URL" ]]; then
  create_or_update_sub \
    "${ENV}-discovery-subscriber-push-sub" \
    "${ENV}-profiles-profile-events-v1" \
    "${DISCOVERY_SUBSCRIBER_URL}/" \
    10
fi

# Messages subscriber (receives match events)
if [[ -n "$MESSAGES_SUBSCRIBER_URL" ]]; then
  create_or_update_sub \
    "${ENV}-messages-subscriber-push-sub" \
    "${ENV}-discovery-match-events-v1" \
    "${MESSAGES_SUBSCRIBER_URL}/" \
    10
fi

# Notifications subscriber (receives match events)
if [[ -n "$NOTIFICATIONS_GO_URL" ]]; then
  create_or_update_sub \
    "${ENV}-notifications-matches-push-sub" \
    "${ENV}-discovery-match-events-v1" \
    "${NOTIFICATIONS_GO_URL}/notifications/subscribers/matches" \
    10

  create_or_update_sub \
    "${ENV}-notifications-messages-push-sub" \
    "${ENV}-messages-message-events-v1" \
    "${NOTIFICATIONS_GO_URL}/notifications/subscribers/messages" \
    10
fi

echo "🎉 Pub/Sub setup complete for ${ENV}!"
