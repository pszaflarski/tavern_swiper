#!/bin/bash

# Configuration with defaults
export GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null)}
export FIRESTORE_DATABASE_ID=${FIRESTORE_DATABASE_ID:-"messages-dev"}
export PROFILE_ID=${PROFILE_ID:-"test_profile_id"}

echo "------------------------------------------------"
echo "🚀 Firestore Match Query Demo (Go)"
echo "------------------------------------------------"
echo "Project:   $GOOGLE_CLOUD_PROJECT"
echo "Database:  $FIRESTORE_DATABASE_ID"
echo "Profile:   $PROFILE_ID"
echo "------------------------------------------------"

if [ -z "$GOOGLE_CLOUD_PROJECT" ]; then
    echo "❌ Error: GOOGLE_CLOUD_PROJECT is not set and could not be detected."
    echo "Please set it manually: export GOOGLE_CLOUD_PROJECT=your-project-id"
    exit 1
fi

# Run the Go demo
go run main.go
