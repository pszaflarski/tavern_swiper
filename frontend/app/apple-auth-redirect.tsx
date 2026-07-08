/**
 * apple-auth-redirect.tsx
 *
 * Web-only route used by the Android native app to perform Apple Sign-In.
 * 
 * Flow:
 * 1. Android app opens this page in a Chrome Custom Tab with ?redirect_uri=tavernswiper://...
 * 2. This page calls Firebase signInWithPopup(auth, appleProvider)
 * 3. Apple's OAuth consent screen appears in a popup
 * 4. After authentication, the popup closes and the Promise resolves
 * 5. This page extracts the Apple ID token from the credential
 * 6. This page redirects to the native app's deep link with the token
 *
 * Using signInWithPopup instead of signInWithRedirect avoids the redirect loop
 * issue where getRedirectResult() returns null in Chrome Custom Tabs.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  OAuthProvider,
  signInWithPopup,
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

    if (!redirect_uri) {
      setError('No redirect URI provided. Cannot return to app.');
      return;
    }

    handleAppleAuth();
  }, []);

  const handleAppleAuth = async () => {
    try {
      setStatus('Opening Apple Sign-In...');
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');

      // signInWithPopup opens Apple's OAuth in a popup window.
      // When the user completes auth, the popup closes and the Promise resolves.
      // No page navigation occurs, so there's no redirect loop.
      const result = await signInWithPopup(auth, provider);

      setStatus('Authentication successful! Returning to app...');
      const credential = OAuthProvider.credentialFromResult(result);
      const idToken = credential?.idToken;

      if (idToken && redirect_uri) {
        const targetUrl = `${redirect_uri}?identityToken=${encodeURIComponent(idToken)}`;
        console.log('[AppleAuthRedirect] Redirecting to native app:', targetUrl);
        window.location.href = targetUrl;
      } else {
        setError('No ID token received from Apple.');
      }
    } catch (err: any) {
      console.error('[AppleAuthRedirect] Error:', err);
      // auth/popup-blocked means the browser blocked the popup
      if (err.code === 'auth/popup-blocked') {
        setError('Popup was blocked by the browser. Please allow popups and try again.');
      } else if (err.code === 'auth/popup-closed-by-user') {
        setError('Sign-in was cancelled.');
      } else {
        setError(err.message || 'An error occurred during Apple Sign-In.');
      }
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
