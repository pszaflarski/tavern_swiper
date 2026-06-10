# Bulk Matching & Hydration Demo

This script demonstrates the full Tavern matching lifecycle at scale. It uses authentic data from the `sample_profiles/profiles.csv`, performs account hydration to ensure no "orphan" profiles are created, and verifies mutual matches.

## Core Assumptions

1.  **Local Auth Service**: You must have the `auth` service running locally (usually on port 8001).
    - It must have `ALLOW_LONG_LIVED_TOKENS=true` set in its environment.
    - It must be configured with the same `JWT_SECRET` as your target backend (if running in Hybrid Mode).
2.  **Environment Logic**: The `auth` service will only issue 100-year tokens if it detects it is running in a development environment (Project ID ending in `-dev` or Emulator active).

## Running in Hybrid Mode (Local Auth + Cloud Backend)

The most powerful way to use this script is to mint tokens locally and target your deployed Cloud Dev environment.

> [!IMPORTANT]
> **JWT Secret Alignment**: For this to work, the `JWT_SECRET` used by your local `auth` service MUST exactly match the `JWT_SECRET` deployed in your Cloud Run services. If they differ, the cloud services will reject the locally-minted tokens as unauthorized.

### Execution Command (Quick Start)

The easiest way to run this against Cloud Dev is using the provided script, which handles the auth service and URL configuration for you:

```bash
./run_cloud_demo.sh --count 5
```

### Manual Execution

If you want to set custom URLs or use a local backend:

```bash
# Set your target Cloud URLs
export USERS_URL="https://users-dev-hhqol7siba-uc.a.run.app/users"
export PROFILES_URL="https://profiles-dev-hhqol7siba-uc.a.run.app/profiles"
export DISCOVERY_URL="https://discovery-dev-hhqol7siba-uc.a.run.app/discovery"

# Target local auth for the 'powerful' tokens
export AUTH_URL="http://localhost:8001/auth"

# Run the demo
python3 bulk_matching_demo.py --count 10
```

## Features

- **Self-Healing Hydration**: Automatically calls `GET /users/me` to ensure a Firestore user record exists before creating a profile.
- **Randomized Pairs**: Selects random unique pairs from the sample CSV for each iteration.
- **Full Verification**: Performs mutual swipes and verifies the final match document exists via the API.
