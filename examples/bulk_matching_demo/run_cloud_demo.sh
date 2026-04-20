#!/bin/bash

# 1. Start local auth service (required for dev-minting tokens)
echo "🚀 Starting local auth service..."
docker compose up -d auth

# 2. Configuration: Target Cloud Dev URLs
export USERS_URL="https://users-dev-hhqol7siba-uc.a.run.app/users"
export PROFILES_URL="https://profiles-dev-hhqol7siba-uc.a.run.app/profiles"
export DISCOVERY_URL="https://discovery-dev-hhqol7siba-uc.a.run.app/discovery"
export AUTH_URL="http://localhost:8001/auth"

# 3. Run the demo
echo "------------------------------------------------"
echo "🛠️  Running Bulk Matching Demo against Cloud Dev"
echo "------------------------------------------------"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/bulk_matching_demo.py" "$@"
