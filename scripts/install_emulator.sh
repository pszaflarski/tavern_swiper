#!/bin/bash
# install_emulator.sh
# Automates the installation of Android SDK and Emulator for headless testing.

set -e

SDK_ROOT="/home/peter/Documents/tavern_swiper/.android_sdk"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

echo "🎭 Preparing the Android Stage..."

# 1. Create SDK directory structure
mkdir -p "$SDK_ROOT/cmdline-tools"

# 2. Download and extract cmdline-tools if not present
if [ ! -d "$SDK_ROOT/cmdline-tools/latest" ]; then
    echo "📥 Downloading Android Command Line Tools..."
    curl -Lo cmdline-tools.zip "$CMDLINE_TOOLS_URL"
    unzip -q cmdline-tools.zip -d "$SDK_ROOT/cmdline-tools"
    mv "$SDK_ROOT/cmdline-tools/cmdline-tools" "$SDK_ROOT/cmdline-tools/latest"
    rm cmdline-tools.zip
    echo "✅ Command Line Tools installed."
fi

# 3. Set Environment Variables for this session
export ANDROID_HOME="$SDK_ROOT"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"

# 4. Accept Licenses
echo "📜 Accepting Android Licenses..."
yes | sdkmanager --licenses > /dev/null

# 5. Install Required Components
echo "🛠️  Installing Platform Tools, Emulator, and System Image..."
sdkmanager "platform-tools" "emulator" "system-images;android-30;google_apis;x86_64" "platforms;android-30"

# 6. Create AVD (Android Virtual Device)
if ! emulator -list-avds | grep -q "MaestroTest"; then
    echo "📱 Creating Virtual Device: MaestroTest..."
    echo "no" | avdmanager create avd -n MaestroTest -k "system-images;android-30;google_apis;x86_64" --force
    echo "✅ AVD created."
else
    echo "📱 AVD MaestroTest already exists."
fi

echo "🚀 Android Environment is ready!"
echo "👉 Run 'export ANDROID_HOME=$SDK_ROOT' and update your PATH to use these tools."
