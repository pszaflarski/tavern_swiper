#!/bin/bash

# Configuration
export GOOGLE_CLOUD_PROJECT="tavern-swiper-dev"
export FIRESTORE_DATABASE_ID="discovery-dev"
export PORT="8080"
export FUNCTION_TARGET="HandleProfileEvent"

echo "🏃 Starting Discovery Subscriber locally on port $PORT..."
echo "📍 Targeting Database: $FIRESTORE_DATABASE_ID"

# Navigate to service directory and run
cd services/discovery_subscriber
go run cmd/main.go
