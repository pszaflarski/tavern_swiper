import * as AppleAuthentication from 'expo-apple-authentication';
import {
  OAuthProvider,
  signInWithCredential,
  linkWithCredential,
  getAdditionalUserInfo,
} from 'firebase/auth';
import { auth } from './firebase';
import { usersApi } from './api';
import { Platform } from 'react-native';

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return await AppleAuthentication.isAvailableAsync();
}

export async function signInWithApple(): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Native Apple Sign-In is not supported on Web.');
  }

  const isAvailable = await AppleAuthentication.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('Apple Sign-In is not available on this device.');
  }

  // 1. Request Apple Credentials
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });

  const { identityToken } = credential;
  if (!identityToken) {
    throw new Error('No identity token received from Apple');
  }

  // 2. Build Firebase credential from Apple token
  const provider = new OAuthProvider('apple.com');
  const firebaseCredential = provider.credential({
    idToken: identityToken,
  });

  // 3. Attempt sign-in — handle account linking if email already exists
  let userCred;
  try {
    userCred = await signInWithCredential(auth, firebaseCredential);
  } catch (error: any) {
    if (error.code === 'auth/account-exists-with-different-credential') {
      if (auth.currentUser) {
        userCred = await linkWithCredential(auth.currentUser, firebaseCredential);
      } else {
        throw new Error(
          'An account already exists with this email. Please sign in with your password first, then link Apple from settings.'
        );
      }
    } else {
      throw error;
    }
  }

  // 4. For new users: auto-populate full_name from Apple profile
  const isNewUser = getAdditionalUserInfo(userCred)?.isNewUser;
  
  // Note: Apple only returns full name on the FIRST sign-in attempt.
  // We grab it from the credential's fullName object if present.
  let fullName = '';
  if (credential.fullName) {
    const { givenName, familyName } = credential.fullName;
    fullName = [givenName, familyName].filter(Boolean).join(' ');
  }

  if (isNewUser && fullName) {
    setTimeout(async () => {
      try {
        await usersApi.put('/users/me', {
          full_name: fullName,
        });
      } catch (e) {
        console.warn('[AppleAuth] Failed to set display name:', e);
      }
    }, 2000);
  }
}
