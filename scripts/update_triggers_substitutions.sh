#!/bin/bash
# ----------------------------------------------------------------
# update_triggers_substitutions.sh
#
# Updates existing Cloud Build triggers in tavern-swiper-dev to
# include the new substitution variables (_JWT_SECRET, _FIREBASE_*)
# that were previously hardcoded in the cloudbuild.yaml files.
#
# Uses export/import workflow since `gcloud builds triggers update`
# has issues with the `--update-substitutions` flag on some versions.
# ----------------------------------------------------------------

set -euo pipefail

PROJECT="tavern-swiper-dev"
REGION="global"
JWT_SECRET="super-secret-tavern-key-123"
FIREBASE_API_KEY="AIzaSyCLDTIuGwoRcGLF1woXC6I1644-jSSXjNk"
FIREBASE_MESSAGING_SENDER_ID="374390417125"
FIREBASE_APP_ID="1:374390417125:web:ec1e664137daa9df11960c"

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "🔧 Updating Cloud Build trigger substitutions in project: $PROJECT"
echo ""

add_substitution() {
    local TRIGGER_NAME="$1"
    local KEY="$2"
    local VALUE="$3"
    local TMPFILE="$TMPDIR/${TRIGGER_NAME}.yaml"

    # Export
    gcloud beta builds triggers export "$TRIGGER_NAME" \
        --destination="$TMPFILE" \
        --project="$PROJECT" \
        --region="$REGION" 2>&1

    # Check if the key already exists
    if grep -q "  $KEY:" "$TMPFILE"; then
        echo "   ℹ️  $KEY already exists in $TRIGGER_NAME, skipping"
        return 0
    fi

    # Append the substitution under the substitutions: block
    sed -i "/^substitutions:/a\\  $KEY: '$VALUE'" "$TMPFILE"

    # Import
    if gcloud beta builds triggers import \
        --source="$TMPFILE" \
        --project="$PROJECT" \
        --region="$REGION" 2>&1; then
        echo "   ✅ Added $KEY to $TRIGGER_NAME"
    else
        echo "   ❌ Failed to import $TRIGGER_NAME"
        return 1
    fi
}

add_multiple_substitutions() {
    local TRIGGER_NAME="$1"
    shift
    local TMPFILE="$TMPDIR/${TRIGGER_NAME}.yaml"

    # Export once
    gcloud beta builds triggers export "$TRIGGER_NAME" \
        --destination="$TMPFILE" \
        --project="$PROJECT" \
        --region="$REGION" 2>&1

    # Add each KEY=VALUE pair
    local CHANGED=false
    while [[ $# -gt 0 ]]; do
        local KEY="${1%%=*}"
        local VALUE="${1#*=}"
        if grep -q "  $KEY:" "$TMPFILE"; then
            echo "   ℹ️  $KEY already exists, skipping"
        else
            sed -i "/^substitutions:/a\\  $KEY: '$VALUE'" "$TMPFILE"
            CHANGED=true
        fi
        shift
    done

    if [[ "$CHANGED" == "false" ]]; then
        echo "   ℹ️  No changes needed for $TRIGGER_NAME"
        return 0
    fi

    # Import
    if gcloud beta builds triggers import \
        --source="$TMPFILE" \
        --project="$PROJECT" \
        --region="$REGION" 2>&1; then
        echo "   ✅ Updated $TRIGGER_NAME"
    else
        echo "   ❌ Failed to import $TRIGGER_NAME"
        return 1
    fi
}

# --- Backend triggers: add _JWT_SECRET ---
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
    echo "📝 $TRIGGER..."
    add_substitution "$TRIGGER" "_JWT_SECRET" "$JWT_SECRET"
done

echo ""

# --- Frontend triggers: add _FIREBASE_* ---
FRONTEND_TRIGGERS=("frontend-dev-deploy" "frontend-test-deploy")

for TRIGGER in "${FRONTEND_TRIGGERS[@]}"; do
    echo "📝 $TRIGGER..."
    add_multiple_substitutions "$TRIGGER" \
        "_FIREBASE_API_KEY=$FIREBASE_API_KEY" \
        "_FIREBASE_MESSAGING_SENDER_ID=$FIREBASE_MESSAGING_SENDER_ID" \
        "_FIREBASE_APP_ID=$FIREBASE_APP_ID"
done

echo ""
echo "✅ Done."
echo ""
echo "💡 Verify with: gcloud builds triggers list --project=$PROJECT --format='table(name,substitutions)'"
