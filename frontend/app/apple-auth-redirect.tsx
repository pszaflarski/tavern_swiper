/**
 * apple-auth-redirect.tsx
 *
 * Web-only route used by the Android native app to perform Apple Sign-In.
 * 
 * Flow:
 * 1. Android app opens this page in a Chrome Custom Tab with ?redirect_uri=tavernswiper://...
 * 2. This page immediately calls Firebase signInWithRedirect(auth, appleProvider)
 * 3. Apple's OAuth consent screen appears
 * 4. After authentication, Firebase redirects back to this page
 * 5. getRedirectResult() extracts the ID token
 * 6. This page redirects to the native app's deep link with the token
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  OAuthProvider,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Colors } from '../theme';

export default function AppleAuthRedirectScreen() {
  const { redirect_uri } = useLocalSearchParams<{ redirect_uri?: string }>();
  const [status, setStatus] = useState<string>('Initializing Apple Sign-In...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      setError('This page is only available on web.');
      return;
    }

    handleAppleAuth();
  }, []);

  const handleAppleAuth = async () => {
    try {
      // Step 1: Check if we're returning from a redirect (post-Apple auth)
      setStatus('Checking for authentication result...');
      const result = await getRedirectResult(auth);

      if (result) {
        // We have a result — extract the Apple ID token
        setStatus('Authentication successful! Returning to app...');
        const credential = OAuthProvider.credentialFromResult(result);
        const idToken = credential?.idToken;

        if (idToken && redirect_uri) {
          // Redirect back to the native app with the token
          const targetUrl = `${redirect_uri}?identityToken=${encodeURIComponent(idToken)}`;
          console.log('[AppleAuthRedirect] Redirecting to native app:', targetUrl);
          window.location.href = targetUrl;
          return;
        } else if (!redirect_uri) {
          setError('No redirect URI provided. Cannot return to app.');
          return;
        } else {
          setError('No ID token received from Apple.');
          return;
        }
      }

      // Step 2: No result yet — initiate the Apple OAuth redirect
      if (!redirect_uri) {
        setError('No redirect URI provided.');
        return;
      }

      setStatus('Redirecting to Apple Sign-In...');
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');

      // This will navigate away from this page to Apple's OAuth consent screen.
      // When the user completes auth, Apple redirects back to Firebase,
      // which redirects back to this page, and getRedirectResult() above picks it up.
      await signInWithRedirect(auth, provider);
    } catch (err: any) {
      console.error('[AppleAuthRedirect] Error:', err);
      setError(err.message || 'An error occurred during Apple Sign-In.');
    }
  };

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: Colors.background,
        padding: 20,
      }}
    >
      {error ? (
        <Text style={{ color: '#ff6b6b', fontSize: 16, textAlign: 'center' }}>
          {error}
        </Text>
      ) : (
        <>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text
            style={{
              color: Colors.onBackground,
              fontSize: 16,
              marginTop: 16,
              textAlign: 'center',
            }}
          >
            {status}
          </Text>
        </>
      )}
    </View>
  );
}
