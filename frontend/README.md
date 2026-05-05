# Frontend

The Tavern Swiper mobile app — a React Native application built with Expo and expo-router. It provides the full user-facing experience: authentication, profile management, a swipe-based discovery feed, match notifications, and real-time messaging.

## Screens

- **Auth** (`app/auth.tsx`) — Login and registration with email/password and Google Sign-In via Firebase Auth
- **Tavern / Discovery** (`app/(tabs)/index.tsx`) — Swipe deck for browsing profiles, with match splash animations on mutual swipes
- **Profiles** (`app/(tabs)/profiles.tsx`) — Create, edit, and manage character profiles; upload and crop images
- **Messages** (`app/(tabs)/messages/`) — Conversation list and chat interface for matched profiles
- **Account** (`app/(tabs)/account.tsx`) — User account settings and logout

## Key Components

- **`SwipeDeck`** — Gesture-driven card stack for the discovery feed with swipe left/right interactions
- **`MatchSplash`** — Animated overlay shown when a mutual match occurs
- **`ImageCropperModal`** — In-app image cropping for profile photos
- **`ScreenErrorBoundary`** — Graceful error handling per screen

## Tech Stack

- **Framework**: Expo SDK 54 + expo-router (file-based routing)
- **Language**: TypeScript
- **State management**: React Query (`@tanstack/react-query`)
- **HTTP client**: Axios
- **Auth**: Firebase JS SDK + `@react-native-google-signin/google-signin`
- **Animations**: react-native-reanimated + react-native-gesture-handler
- **Fonts**: Google Fonts (Manrope, Noto Serif)
- **Testing**: Jest + React Native Testing Library + Maestro (E2E)
- **Build**: EAS Build (Android APK/AAB)
- **Deployment**: EAS + Cloud Build

## Running

```bash
# Install dependencies
npm install

# Start the Expo dev server
npx expo start

# Run on Android device/emulator
npm run android
```

### With Docker

```bash
docker build -t tavern-swiper-frontend ./frontend
docker run -p 8080:8080 tavern-swiper-frontend
```

## Testing

### Unit Tests (Jest)

```bash
# Run all unit tests
npm run test:jest

# Run snapshot tests only
npm run test:snapshots
```

### E2E Tests (Maestro)

```bash
# Run Maestro tests via Docker (full environment)
npm run test:maestro

# Run Maestro tests directly (requires local emulator + APK)
npm run test:maestro:direct
```

## Environment

The app connects to different backends based on `EXPO_PUBLIC_FIREBASE_PROJECT_ID`:
- **Dev**: `tavern-swiper-dev` (uses `google-services.dev.json`)
- **Prod**: `tavern-swiper-prod` (uses `google-services.prod.json`)

API base URLs and Firebase config are set via environment variables in `.env`.
