#!/usr/bin/env bash
set -euo pipefail

# Set local Android SDK paths
export ANDROID_HOME="/home/peter/Documents/tavern_swiper/.android_sdk"
export PATH="$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"

# Run EAS build locally for the emulator
echo "🚀 Starting local EAS build..."
npx eas-cli build --profile emulator --platform android --local
