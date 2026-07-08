/**
 * apple-auth-redirect.tsx
 *
 * Web-only route used by the Android native app to perform Apple Sign-In.
 * 
 * Flow:
 * 1. Android app opens this page in a Chrome Custom Tab with ?redirect_uri=tavernswiper://...
 * 2. This page stores redirect_uri in sessionStorage (survives the OAuth redirect)
 * 3. Calls Firebase signInWithRedirect(auth, appleProvider)
 * 4. Apple's OAuth consent screen appears
 * 5. After authentication, Firebase redirects back to this page
 * 6. getRedirectResult() extracts the ID token
 * 7. This page reads redirect_uri from sessionStorage and deep-links back to the native app
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

const REDIRECT_URI_KEY = 'apple_auth_redirect_uri';

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
      // If we have a redirect_uri param, persist it before the OAuth redirect wipes it
      if (redirect_uri && typeof window !== 'undefined') {
        window.sessionStorage.setItem(REDIRECT_URI_KEY, redirect_uri);
      }

      // Resolve the redirect URI: prefer the query param, fall back to sessionStorage
      const resolvedRedirectUri =
        redirect_uri ||
        (typeof window !== 'undefined'
          ? window.sessionStorage.getItem(REDIRECT_URI_KEY)
          : null);

      // Step 1: Check if we're returning from a redirect (post-Apple auth)
      setStatus('Checking for authentication result...');
      const result = await getRedirectResult(auth);

      if (result) {
        // We have a result — extract the Apple ID token
        setStatus('Authentication successful! Returning to app...');
        const credential = OAuthProvider.credentialFromResult(result);
        const idToken = credential?.idToken;

        // Clean up sessionStorage
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(REDIRECT_URI_KEY);
        }

        if (idToken && resolvedRedirectUri) {
          // Redirect back to the native app with the token
          const targetUrl = `${resolvedRedirectUri}?identityToken=${encodeURIComponent(idToken)}`;
          console.log('[AppleAuthRedirect] Redirecting to native app:', targetUrl);
          window.location.href = targetUrl;
          return;
        } else if (!resolvedRedirectUri) {
          setError('No redirect URI available. Cannot return to app.');
          return;
        } else {
          setError('No ID token received from Apple.');
          return;
        }
      }

      // Step 2: No result yet — initiate the Apple OAuth redirect
      if (!resolvedRedirectUri) {
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
