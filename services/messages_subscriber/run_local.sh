#!/bin/bash
# run_local.sh - Run the Messages Subscriber locally

# Environment Variables (Defaults for Local Emulator)
export PUBSUB_PROJECT_ID=${PUBSUB_PROJECT_ID:-tavern-swiper-dev}
export PUBSUB_TOPIC_ID=${PUBSUB_TOPIC_ID:-dev-discovery-match-events-v1}
export PUBSUB_SUB_ID=${PUBSUB_SUB_ID:-dev-messages-from-discovery-match-events-v1-sub}
export FIRESTORE_DATABASE_ID=${FIRESTORE_DATABASE_ID:-messages-dev}
export PORT=${PORT:-8008}

# If Pub/Sub emulator host is set, Go client will automatically use it
# export PUBSUB_EMULATOR_HOST=localhost:8085

echo "🚀 Starting Messages Subscriber (Go)..."
go run main.go
