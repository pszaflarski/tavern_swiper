# Migrate from RN `<Image>` to `expo-image`

## Summary

Replace React Native's built-in `<Image>` component with `expo-image` across the frontend for better scroll performance and image loading UX.

## Why

- **Disk + memory caching** — RN `<Image>` relies on inconsistent platform HTTP caching. `expo-image` provides explicit `cachePolicy="memory-disk"` so images load instantly on revisit without flickering.
- **Off-thread decoding** — Image decoding always happens off the main thread, preventing frame drops when multiple images enter the viewport during scrolling.
- **Placeholder/transition support** — Supports `blurhash` or color placeholders with crossfade transitions, eliminating the "empty box → pop-in" flash.
- **View recycling** — Recycles underlying native image views in lists instead of creating/destroying them.

## Current State

- `expo-image` is **not installed** — only `expo-image-picker` and `expo-image-manipulator` exist in `package.json`.
- Every screen currently uses `import { Image } from 'react-native'`.

## Scope

All screens rendering remote images, including:
- **InboxScreen** — profile tab thumbnails, new match thumbnails, inbox avatars
- **DiscoveryScreen / SwipeDeck** — full-screen profile card photos
- **ProfileListScreen** — profile card thumbnails
- **ChatScreen** — avatar images in message bubbles
- **ProfileDetailScreen** — photo carousel

## Steps

1. `npx expo install expo-image`
2. Replace `import { Image } from 'react-native'` → `import { Image } from 'expo-image'`
3. Replace `resizeMode` prop → `contentFit` (e.g., `contentFit="cover"`)
4. Add `cachePolicy="memory-disk"` to all remote image instances
5. Optionally add `transition={200}` for smooth fade-in on load
6. Test on both iOS and Android — `expo-image` uses different native backends per platform
