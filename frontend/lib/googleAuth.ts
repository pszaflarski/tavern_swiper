import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  signInWithCredential,
  linkWithCredential,
} from 'firebase/auth';
import { auth } from './firebase';
import { usersApi } from './api';

// Configure once at module load
GoogleSignin.configure({
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

/**
 * Performs the full Google Sign-In flow:
 *   1. Native Google account picker
 *   2. Exchange Google token for Firebase credential
 *   3. Handle account linking if email already exists with a different provider
 *   4. Auto-populate full_name from Google profile for new users
 */
export async function signInWithGoogle(): Promise<void> {
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
      // User already has an email/password account with this email.
      // If they are currently signed in, link the Google provider.
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

  // 5. For new users: register in our users service with full_name from Google
  const isNewUser = userCred.additionalUserInfo?.isNewUser;
  if (isNewUser) {
    const token = await userCred.user.getIdToken();
    const displayName = userCred.user.displayName || '';

    await usersApi.post('/users/', {
      email: userCred.user.email,
      full_name: displayName,
      user_type: 'user',
      is_premium: false,
    }, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}

export { statusCodes };
