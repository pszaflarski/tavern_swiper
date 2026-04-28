#!/usr/bin/env bash
# ------------------------------------------------------------------
# setup-eas-env.sh
#
# Push all frontend environment variables to EAS as project-scoped
# environment variables.
#
# Usage:
#   chmod +x setup-eas-env.sh
#   ./setup-eas-env.sh              # defaults to "development"
#   ./setup-eas-env.sh preview      # target preview environment
#   ./setup-eas-env.sh production   # target production environment
#
# NOTE: `eas secret:create` is deprecated. The modern command is
#       `eas env:create`. If your CLI version doesn't support it,
#       run:  npm install -g eas-cli@latest
# ------------------------------------------------------------------

set -euo pipefail

ENV="${1:-development}"

echo "🔧 Pushing environment variables to EAS (environment: $ENV)..."
echo ""

# --- Service URLs ---
eas env:create --name EXPO_PUBLIC_AUTH_URL \
  --value "https://auth-dev-hhqol7siba-uc.a.run.app" \
  --environment "$ENV" --type string --visibility plaintext

eas env:create --name EXPO_PUBLIC_PROFILES_URL \
  --value "https://profiles-dev-hhqol7siba-uc.a.run.app" \
  --environment "$ENV" --type string --visibility plaintext

eas env:create --name EXPO_PUBLIC_DISCOVERY_URL \
  --value "https://discovery-dev-hhqol7siba-uc.a.run.app" \
  --environment "$ENV" --type string --visibility plaintext

eas env:create --name EXPO_PUBLIC_MESSAGES_URL \
  --value "https://messages-dev-hhqol7siba-uc.a.run.app" \
  --environment "$ENV" --type string --visibility plaintext

eas env:create --name EXPO_PUBLIC_USERS_URL \
  --value "https://users-dev-hhqol7siba-uc.a.run.app" \
  --environment "$ENV" --type string --visibility plaintext

# --- Firebase Config ---
eas env:create --name EXPO_PUBLIC_FIREBASE_API_KEY \
  --value "AIzaSyCLDTIuGwoRcGLF1woXC6I1644-jSSXjNk" \
  --environment "$ENV" --type string --visibility plaintext

eas env:create --name EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN \
  --value "tavern-swiper-dev.firebaseapp.com" \
  --environment "$ENV" --type string --visibility plaintext

eas env:create --name EXPO_PUBLIC_FIREBASE_PROJECT_ID \
  --value "tavern-swiper-dev" \
  --environment "$ENV" --type string --visibility plaintext

eas env:create --name EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET \
  --value "tavern-swiper-dev.firebasestorage.app" \
  --environment "$ENV" --type string --visibility plaintext

eas env:create --name EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
  --value "374390417125" \
  --environment "$ENV" --type string --visibility plaintext

eas env:create --name EXPO_PUBLIC_FIREBASE_APP_ID \
  --value "1:374390417125:web:ec1e664137daa9df11960c" \
  --environment "$ENV" --type string --visibility plaintext

echo ""
echo "✅ All environment variables pushed to EAS ($ENV)."
echo ""
echo "💡 To verify, run:  eas env:list --environment $ENV"
echo "💡 For preview/production, update the values and re-run:"
echo "   ./setup-eas-env.sh preview"
echo "   ./setup-eas-env.sh production"
