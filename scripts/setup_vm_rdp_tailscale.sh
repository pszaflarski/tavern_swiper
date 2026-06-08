#!/usr/bin/env bash
# ==============================================================================
# Script Name: setup_vm_rdp_tailscale.sh
# Description: Installs and configures XFCE, XRDP (RDP), and Tailscale on Ubuntu.
#              Sets a secure password for the RDP user and outputs connection details.
# ==============================================================================

set -euo pipefail

log_info() {
  echo -e "[INFO] $(date +'%Y-%m-%d %H:%M:%S') - $1"
}

# 1. Update and upgrade repositories
log_info "Updating system package repositories..."
sudo apt-get update -y

# 2. Install XFCE4 Desktop and xrdp
log_info "Installing XFCE4 desktop environment (lightweight for RDP)..."
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y xfce4 xfce4-goodies

log_info "Installing xrdp server..."
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y xrdp

# Configure xrdp to use XFCE
log_info "Configuring xrdp to use XFCE session..."
sudo adduser xrdp ssl-cert

# Set xfce4-session as the default for current user
echo "xfce4-session" > ~/.xsession
chmod +x ~/.xsession

# Configure system-wide xrdp settings
sudo sed -i 's/allowed_users=console/allowed_users=anybody/g' /etc/xrdp/Xwrapper.config || true

# Restart and enable xrdp
log_info "Enabling and starting xrdp service..."
sudo systemctl enable xrdp
sudo systemctl restart xrdp

# 3. Setup a password for RDP authentication
CURRENT_USER=$(whoami)
# Generate a random 16 character password
RDP_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=')
echo "${CURRENT_USER}:${RDP_PASSWORD}" | sudo chpasswd
log_info "RDP credentials set for user: '${CURRENT_USER}'"

# 4. Install Tailscale
log_info "Installing Tailscale..."
curl -fsSL https://tailscale.com/install.sh | sh

log_info "============================================================"
log_info "SETUP COMPLETE!"
log_info "Your RDP Credentials:"
log_info "  Username: ${CURRENT_USER}"
log_info "  Password: ${RDP_PASSWORD}"
log_info "============================================================"
log_info "Now starting Tailscale. Please click the URL below to authenticate:"
log_info "============================================================"

# Start tailscale up in a way that allows authentication.
# Note: we use sudo tailscale up. It will output the login URL.
sudo tailscale up
