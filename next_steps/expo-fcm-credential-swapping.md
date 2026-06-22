# Expo FCM Credential Swapping — Known Limitation

## Problem

Expo shares a **single FCM V1 service account key** across all Android build profiles (dev, preview, production). This means:

- Dev app push tokens are registered against `tavern-swiper-dev` (sender ID `374390417125`)
- Prod app push tokens are registered against `tavern-swiper-prod` (sender ID `43551826902`)
- Only **one** FCM key can be active at a time in Expo
- Push notifications will fail for whichever environment's key is **not** currently configured

## Current State

The FCM key is set to **production** (`tavern-swiper-prod`). This means:
- ✅ Prod push notifications work
- ❌ Dev push notifications will fail (sender mismatch)

## Manual Swap Commands

### Swap to Prod
```bash
SESSION=$(python3 -c "import json; print(json.load(open('/home/peter/.expo/state.json'))['auth']['sessionSecret'])")
curl -s -X POST "https://api.expo.dev/graphql" \
  -H "Content-Type: application/json" \
  -H "expo-session: $SESSION" \
  -d '{"query": "mutation { androidAppCredentials { setGoogleServiceAccountKeyForFcmV1(id: \"61597c7d-7367-493f-89b3-c2106cb9b196\", googleServiceAccountKeyId: \"8c682473-e7d2-4b13-a951-7f3f9b20d49f\") { id googleServiceAccountKeyForFcmV1 { clientEmail projectIdentifier } } } }"}'
```

### Swap to Dev
```bash
SESSION=$(python3 -c "import json; print(json.load(open('/home/peter/.expo/state.json'))['auth']['sessionSecret'])")
curl -s -X POST "https://api.expo.dev/graphql" \
  -H "Content-Type: application/json" \
  -H "expo-session: $SESSION" \
  -d '{"query": "mutation { androidAppCredentials { setGoogleServiceAccountKeyForFcmV1(id: \"61597c7d-7367-493f-89b3-c2106cb9b196\", googleServiceAccountKeyId: \"cfea0e02-2415-403d-acc5-a62fcdeb2648\") { id googleServiceAccountKeyForFcmV1 { clientEmail projectIdentifier } } } }"}'
```

## Future Fix Options

1. **Separate Expo projects** — Create a second Expo project for dev so each has its own FCM key slot
2. **Bypass Expo Push** — Send directly via FCM HTTP v1 API from `notifications_subscriber`, using the correct service account per environment (no Expo middleman)
3. **EAS Metadata API** — Expo may add per-profile FCM key support in the future

## Key IDs Reference

| Key ID | Environment | Service Account |
|--------|-------------|-----------------|
| `cfea0e02-2415-403d-acc5-a62fcdeb2648` | Dev | `firebase-adminsdk-fbsvc@tavern-swiper-dev.iam.gserviceaccount.com` |
| `8c682473-e7d2-4b13-a951-7f3f9b20d49f` | Prod | `firebase-adminsdk-fbsvc@tavern-swiper-prod.iam.gserviceaccount.com` |
