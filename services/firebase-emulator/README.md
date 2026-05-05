# Firebase Emulator

A lightweight Docker container that runs the Firebase Auth Emulator for local development and testing. This provides a fully offline Firebase Authentication backend so the Auth service can register users, sign in, and verify tokens without hitting the real Firebase project.

## Configuration

- **Emulated service**: Firebase Auth only
- **Port**: `9099`
- **Project ID**: `tavern-swiper-dev`
- **Base image**: `node:lts-slim` with `firebase-tools` installed globally

## Usage

This container is managed by `docker-compose.yml` and starts automatically alongside the other services. The Auth service connects to it via:

```
FIREBASE_AUTH_EMULATOR_HOST=firebase-emulator:9099
FIREBASE_AUTH_URL=http://firebase-emulator:9099/identitytoolkit.googleapis.com/v1/accounts
```

No additional setup or data seeding is needed — the emulator starts with a clean state each time.
