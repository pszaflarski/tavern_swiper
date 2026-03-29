#!/bin/bash
# scripts/run_cloud_maestro_tests.sh
# Orchestrates Maestro UI tests against the Cloud Run 'test' environment.

set -e

SDK_ROOT="/home/peter/Documents/tavern_swiper/.android_sdk"
export ANDROID_HOME="$SDK_ROOT"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"

echo "🏹 Starting Maestro Cloud Quest..."

# 1. Switch frontend environment to TEST
echo "🔄 Switching frontend to [test] environment..."
bash scripts/switch_env.sh test

# 2. Start the Emulator in headless mode
if ! adb devices | grep -q "emulator"; then
    echo "📱 Starting Emulator (MaestroTest) in headless mode..."
    # Start emulator in background with no window/audio
    emulator -avd MaestroTest -no-window -no-audio -no-boot-anim -gpu off &
else
    echo "✅ Emulator is already running."
fi

echo "⏳ Waiting for emulator to boot..."
adb wait-for-device
    
# Wait for the system to be fully ready
while [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" != "1" ]; do
    sleep 5
done
echo "✅ Emulator is ready!"

# 3. Build and Install the Frontend
echo "🏗️  Building and installing frontend for Android..."
cd frontend
# npx expo run:android builds the app and installs it on the connected device/emulator
# We use --no-interactive to avoid prompts
npx expo run:android --no-interactive --variant release

# 4. Execute the Maestro Flow
echo "🎭 Running onboarding and profile creation flow..."
cd ..
maestro test frontend/maestro/signup_and_forge.yaml

# 5. Cleanup
echo "🧹 Stopping the emulator..."
adb emu kill || true

echo "✅ Quest Complete!"
