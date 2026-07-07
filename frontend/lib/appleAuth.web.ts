import {
  OAuthProvider,
  signInWithPopup,
  linkWithCredential,
  getAdditionalUserInfo,
} from 'firebase/auth';
import { auth } from './firebase';
import { usersApi } from './api';

export async function isAppleSignInAvailable(): Promise<boolean> {
  // Apple Sign-In is always available on the web via popup
  return true;
}

export async function signInWithApple(): Promise<void> {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');

  let userCred;
  try {
    userCred = await signInWithPopup(auth, provider);
  } catch (error: any) {
    if (error.code === 'auth/account-exists-with-different-credential') {
      if (auth.currentUser) {
        userCred = await linkWithCredential(auth.currentUser, provider.credential());
      } else {
        throw new Error(
          'An account already exists with this email. Please sign in with your password first, then link Apple from settings.'
        );
      }
    } else {
      throw error;
    }
  }

  // Auto-populate display name for new users
  const isNewUser = getAdditionalUserInfo(userCred)?.isNewUser;
  if (isNewUser && userCred.user.displayName) {
    setTimeout(async () => {
      try {
        await usersApi.put('/users/me', {
          full_name: userCred.user.displayName,
        });
      } catch (e) {
        console.warn('[AppleAuth] Failed to set display name:', e);
      }
    }, 2000);
  }
}
