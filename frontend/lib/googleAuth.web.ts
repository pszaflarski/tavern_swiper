import {
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { auth } from './firebase';
import { usersApi } from './api';

export const statusCodes = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
};

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();

  let userCred;
  try {
    userCred = await signInWithPopup(auth, provider);
  } catch (error: any) {
    if (error.code === 'auth/account-exists-with-different-credential') {
      throw new Error(
        'An account already exists with this email. Please sign in with your password first.'
      );
    }
    throw error;
  }

  // For new users: auto-populate full_name from Google profile
  const isNewUser = (userCred as any).additionalUserInfo?.isNewUser;
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
  // No-op on web — Firebase signOut handles everything
}
