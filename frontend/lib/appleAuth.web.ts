import {
  OAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  linkWithCredential,
  getAdditionalUserInfo,
} from 'firebase/auth';
import { auth } from './firebase';
import { usersApi } from './api';

export async function isAppleSignInAvailable(): Promise<boolean> {
  // Apple Sign-In is always available on the web via popup/redirect
  return true;
}

export async function handleRedirectResult(): Promise<string | null> {
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      const credential = OAuthProvider.credentialFromResult(result);
      const idToken = credential?.idToken || null;

      // Auto-populate display name for new users
      const isNewUser = getAdditionalUserInfo(result)?.isNewUser;
      if (isNewUser && result.user.displayName) {
        try {
          await usersApi.put('/users/me', {
            full_name: result.user.displayName,
          });
        } catch (e) {
          console.warn('[AppleAuth] Failed to set display name on redirect:', e);
        }
      }
      return idToken;
    }
  } catch (err) {
    console.error('[AppleAuth] getRedirectResult failed:', err);
  }
  return null;
}

export async function signInWithApple(useRedirect: boolean = false): Promise<string | null> {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');

  if (useRedirect) {
    console.log('[AppleAuth] Initiating signInWithRedirect...');
    await signInWithRedirect(auth, provider);
    return null;
  }

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

  const credential = OAuthProvider.credentialFromResult(userCred);
  return credential?.idToken || null;
}
