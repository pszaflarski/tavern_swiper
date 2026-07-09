import {
  GoogleAuthProvider,
  signInWithCredential,
  linkWithCredential,
  getAdditionalUserInfo,
} from 'firebase/auth';
import { auth } from './firebase';
import { usersApi } from './api';
import { Platform } from 'react-native';

// Lazy-load the native module to avoid crashing in Expo Go
let GoogleSignin: any = null;
let nativeStatusCodes: any = {};

try {
  const mod = require('@react-native-google-signin/google-signin');
  GoogleSignin = mod.GoogleSignin;
  nativeStatusCodes = mod.statusCodes;

  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  });
} catch (e) {
  console.warn('[GoogleAuth] Native Google Sign-In module not available or failed to configure:', e);
}

export const statusCodes = nativeStatusCodes;

export async function signInWithGoogle(): Promise<void> {
  if (!GoogleSignin) {
    throw new Error('Google Sign-In requires a native build. It is not available in Expo Go.');
  }

  // 1. Check for Google Play Services
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // 2. Trigger the native Google Sign-In UI
  const response = await GoogleSignin.signIn();
  const idToken = response.data?.idToken;

  if (!idToken) {
    throw new Error('No ID token received from Google');
  }

  // 3. Build Firebase credential from Google token
  const credential = GoogleAuthProvider.credential(idToken);

  // 4. Attempt sign-in — handle account linking if email already exists
  let userCred;
  try {
    userCred = await signInWithCredential(auth, credential);
  } catch (error: any) {
    if (error.code === 'auth/account-exists-with-different-credential') {
      if (auth.currentUser) {
        userCred = await linkWithCredential(auth.currentUser, credential);
      } else {
        throw new Error(
          'An account already exists with this email. Please sign in with your password first, then link Google from settings.'
        );
      }
    } else {
      throw error;
    }
  }

  // 5. For new users: auto-populate full_name from Google profile
  const isNewUser = getAdditionalUserInfo(userCred)?.isNewUser;
  if (isNewUser && userCred.user.displayName) {
    setTimeout(async () => {
      try {
        await usersApi.put('/users/me', {
          full_name: userCred.user.displayName,
        });
      } catch (e) {
        console.warn('[GoogleAuth] Failed to set display name:', e);
      }
    }, 2000);
  }
}

export async function signOutFromGoogle(): Promise<void> {
  if (!GoogleSignin) return;
  try {
    await GoogleSignin.signOut();
  } catch (e) {
    // Not signed in with Google — ignore
  }
}
