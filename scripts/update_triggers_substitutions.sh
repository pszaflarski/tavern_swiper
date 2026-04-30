#!/bin/bash
# ----------------------------------------------------------------
# update_triggers_substitutions.sh
#
# Updates existing Cloud Build triggers in tavern-swiper-dev to
# include the new substitution variables (_JWT_SECRET, _FIREBASE_*)
# that were previously hardcoded in the cloudbuild.yaml files.
#
# Usage:
#   chmod +x scripts/update_triggers_substitutions.sh
#   ./scripts/update_triggers_substitutions.sh
#
# NOTE: This is a one-time migration script. After running, the
#       triggers will pass these values via substitutions instead
#       of relying on hardcoded values in the YAML.
# ----------------------------------------------------------------

set -euo pipefail

PROJECT="tavern-swiper-dev"
JWT_SECRET="super-secret-tavern-key-123"
FIREBASE_API_KEY="AIzaSyCLDTIuGwoRcGLF1woXC6I1644-jSSXjNk"
FIREBASE_MESSAGING_SENDER_ID="374390417125"
FIREBASE_APP_ID="1:374390417125:web:ec1e664137daa9df11960c"

echo "🔧 Updating Cloud Build trigger substitutions in project: $PROJECT"
echo ""

# --- Backend service triggers (need _JWT_SECRET) ---
# Format: "trigger-name:additional_subs"
BACKEND_TRIGGERS=(
    "auth-dev-deploy"
    "auth-test-deploy"
    "users-dev-deploy"
    "users-test-deploy"
    "profiles-dev-deploy"
    "profiles-test-deploy"
    "discovery-dev-deploy"
    "discovery-test-deploy"
    "messages-dev-deploy"
    "messages-test-deploy"
)

for TRIGGER in "${BACKEND_TRIGGERS[@]}"; do
    echo "📝 Updating $TRIGGER with _JWT_SECRET..."
    gcloud builds triggers update "$TRIGGER" \
        --project="$PROJECT" \
        --update-substitutions="_JWT_SECRET=$JWT_SECRET" \
        --quiet 2>&1 || echo "⚠️  Failed to update $TRIGGER"
done

echo ""

# --- Frontend triggers (need _FIREBASE_*) ---
FRONTEND_TRIGGERS=("frontend-dev-deploy" "frontend-test-deploy")

for TRIGGER in "${FRONTEND_TRIGGERS[@]}"; do
    echo "📝 Updating $TRIGGER with _FIREBASE_API_KEY, _FIREBASE_MESSAGING_SENDER_ID, _FIREBASE_APP_ID..."
    gcloud builds triggers update "$TRIGGER" \
        --project="$PROJECT" \
        --update-substitutions="_FIREBASE_API_KEY=$FIREBASE_API_KEY,_FIREBASE_MESSAGING_SENDER_ID=$FIREBASE_MESSAGING_SENDER_ID,_FIREBASE_APP_ID=$FIREBASE_APP_ID" \
        --quiet 2>&1 || echo "⚠️  Failed to update $TRIGGER"
done

echo ""
echo "✅ All triggers updated."
echo ""
echo "💡 Verify with: gcloud builds triggers list --project=$PROJECT --format='table(name,substitutions)'"
