# Keyboard Handling Methodology

This document records the "Gold Standard" for keyboard handling in the Tavern Swiper mobile application.

## The Problem
Standard `KeyboardAvoidingView` often fails in complex layouts (nested stacks, tab bars, transclucent headers) due to:
- Relying on JavaScript-driven measurements that lag behind native animations.
- Conflict with Android's `softwareKeyboardLayoutMode`.
- Inconsistent behavior on notched devices (safe area insets).

## The Solution
We use a high-performance, native-frame-synced approach:

1. **`react-native-keyboard-controller`**: We use this library instead of the built-in `KeyboardAvoidingView`. It hooks directly into the native keyboard animation frames.
2. **`useReanimatedKeyboardAnimation`**: This hook provides a Reanimated shared value (`height`) that represents the keyboard's height in real-time.
3. **Absolute Positioning**: The input bar is positioned with `position: 'absolute', bottom: 0`. We then apply a `transform: [{ translateY: keyboardHeight }]` to move it up with the keyboard.
4. **Dynamic FlatList Spacer**: To ensure the list content is never obscured by the elevated input bar, we use a `ListFooterComponent` containing an `Animated.View`. Its height is dynamically calculated as:
   `INPUT_BAR_HEIGHT + insets.bottom + Math.abs(keyboardHeight)`

## Why This Works
- **Zero Lag**: Animations are frame-synced on the UI thread.
- **Full Control**: We control exactly how much padding is added and where.
- **Platform Agnostic**: Works consistently on both iOS and Android without requiring platform-specific magic numbers.

## Implementation Example
See `frontend/app/(tabs)/messages/[id].tsx` for the reference implementation.

---
*Note: Do not revert to KeyboardAvoidingView or manual height listeners without significant justification.*
