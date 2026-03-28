#!/bin/bash

# install_maestro.sh
# Automates the installation of Maestro CLI for Linux environments.

set -e

echo "🏹 Preparing to install the Maestro CLI..."

# 1. Install Maestro via official script
if ! command -v maestro &> /dev/null
then
    echo "📥 Downloading and installing Maestro..."
    curl -Ls "https://get.maestro.mobile.dev" | bash
    
    # Add to current path for this session
    export PATH="$PATH:$HOME/.maestro/bin"
    echo "export PATH=\"\$PATH:\$HOME/.maestro/bin\"" >> ~/.bashrc
    echo "✅ Maestro installed to $HOME/.maestro/bin"
else
    echo "👋 Maestro is already installed."
fi

# 2. Check for ADB (Android Debug Bridge)
if ! command -v adb &> /dev/null
then
    echo "⚠️  ADB not found. UI tests require a connected device or emulator."
    echo "👉 Install with: sudo apt install adb (if you have permissions)"
else
    echo "✅ ADB is available."
fi

echo "🚀 Maestro setup complete. Reload your shell or run 'source ~/.bashrc'."
