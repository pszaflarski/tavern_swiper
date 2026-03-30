#!/bin/bash
export GOOGLE_CLOUD_PROJECT=tavern-swiper-dev
export FIRESTORE_DATABASE_ID=profiles-test
export AUTH_SERVICE_URL=https://auth-test-374390417125.us-central1.run.app
export PORT=8002

echo "🚀 Starting local Profiles service on port $PORT..."
echo "🔗 Connected to cloud Auth: $AUTH_SERVICE_URL"
echo "📂 Firestore Database ID: $FIRESTORE_DATABASE_ID"

../../.venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port $PORT --reload
