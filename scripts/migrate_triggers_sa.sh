#!/bin/bash
set -e

PROJECT_ID="tavern-swiper-dev"
NEW_SA="cicd-builder@${PROJECT_ID}.iam.gserviceaccount.com"

# 1. Get List of all Triggers
echo "🔍 Fetching all Cloud Build triggers in $PROJECT_ID..."
TRIGGERS=$(gcloud builds triggers list --project="$PROJECT_ID" --format="value(name)")

# 2. Iterate and Update
for TRIGGER in $TRIGGERS; do
    echo "⚙️  Updating Trigger: $TRIGGER to use $NEW_SA..."
    # github triggers must use 'update github' specifically in beta
    gcloud beta builds triggers update github "$TRIGGER" \
        --service-account="projects/${PROJECT_ID}/serviceAccounts/${NEW_SA}" \
        --project="$PROJECT_ID" \
        --quiet
done

echo "✅ All triggers migrated to dedicated CI/CD service account."
