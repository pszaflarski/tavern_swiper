/**
 * apple-auth-callback.tsx
 *
 * Dummy route that handles the deep link callback from Apple Sign-In on Android.
 * 
 * This page exists only to prevent Expo Router's "unmatched route" error.
 * The actual token handling happens in appleAuth.ts via openAuthSessionAsync(),
 * which intercepts the deep link URL before this page renders.
 * 
 * If the user somehow lands here (e.g., openAuthSessionAsync didn't catch it),
 * show a brief loading state and redirect back to auth.
 */
import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '../theme';

export default function AppleAuthCallbackScreen() {
  const router = useRouter();

  useEffect(() => {
    // If we somehow land here without openAuthSessionAsync catching the URL,
    // redirect back to the auth screen after a brief delay.
    const timeout = setTimeout(() => {
      router.replace('/auth');
    }, 2000);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: Colors.background,
      }}
    >
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}
