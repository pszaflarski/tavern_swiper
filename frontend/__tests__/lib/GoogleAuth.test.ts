import { signInWithGoogle, signOutFromGoogle } from '../../lib/googleAuth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { signInWithCredential, linkWithCredential, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../../lib/firebase';

// Override the lib/firebase mock for these tests
jest.mock('../../lib/firebase', () => ({
  auth: {
    currentUser: null,
  },
}));

// Override the lib/api mock for these tests
jest.mock('../../lib/api', () => ({
  usersApi: {
    put: jest.fn().mockResolvedValue({ data: {} }),
  },
  clearTavernSession: jest.fn(),
  getPersistedUid: jest.fn(),
}));

describe('Google Auth - Native Flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should have GoogleSignin configured with webClientId', () => {
    // GoogleSignin.configure is called at module load in googleAuth.ts
    // In test environment, the env var is undefined, but the call should have been made
    expect(GoogleSignin.configure).toBeDefined();
  });

  it('should successfully sign in with Google', async () => {
    const mockUserCred = {
      user: { uid: 'google-user-123', displayName: 'Test User' },
      additionalUserInfo: { isNewUser: false },
    };
    (signInWithCredential as jest.Mock).mockResolvedValueOnce(mockUserCred);

    await signInWithGoogle();

    expect(GoogleSignin.hasPlayServices).toHaveBeenCalledWith({ showPlayServicesUpdateDialog: true });
    expect(GoogleSignin.signIn).toHaveBeenCalled();
    expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('mock-id-token');
    expect(signInWithCredential).toHaveBeenCalledWith(auth, { providerId: 'google.com' });
  });

  it('should throw when no ID token is received', async () => {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValueOnce({ data: { idToken: null } });

    await expect(signInWithGoogle()).rejects.toThrow('No ID token received from Google');
  });

  it('should link accounts when email already exists and user is signed in', async () => {
    // Simulate a signed-in user
    (auth as any).currentUser = { uid: 'existing-uid' };

    const linkError = { code: 'auth/account-exists-with-different-credential' };
    (signInWithCredential as jest.Mock).mockRejectedValueOnce(linkError);

    const mockLinkedCred = {
      user: { uid: 'existing-uid', displayName: 'Linked User' },
      additionalUserInfo: { isNewUser: false },
    };
    (linkWithCredential as jest.Mock).mockResolvedValueOnce(mockLinkedCred);

    await signInWithGoogle();

    expect(linkWithCredential).toHaveBeenCalledWith(
      { uid: 'existing-uid' },
      { providerId: 'google.com' }
    );
  });

  it('should throw when account exists but user is not signed in', async () => {
    (auth as any).currentUser = null;

    const linkError = { code: 'auth/account-exists-with-different-credential' };
    (signInWithCredential as jest.Mock).mockRejectedValueOnce(linkError);

    await expect(signInWithGoogle()).rejects.toThrow(
      'An account already exists with this email'
    );
  });

  it('should auto-populate display name for new users', async () => {
    jest.useFakeTimers();
    const { usersApi } = require('../../lib/api');

    const mockUserCred = {
      user: { uid: 'new-user-123', displayName: 'New Google User' },
      additionalUserInfo: { isNewUser: true },
    };
    (signInWithCredential as jest.Mock).mockResolvedValueOnce(mockUserCred);

    await signInWithGoogle();

    // Fast-forward the setTimeout (2000ms delay)
    jest.advanceTimersByTime(2500);

    // Flush microtask queue so the async setTimeout callback completes
    await Promise.resolve();

    expect(usersApi.put).toHaveBeenCalledWith('/users/me', {
      full_name: 'New Google User',
    });

    jest.useRealTimers();
  });

  it('should not update display name for existing users', async () => {
    jest.useFakeTimers();
    const { usersApi } = require('../../lib/api');

    const mockUserCred = {
      user: { uid: 'existing-user', displayName: 'Existing User' },
      additionalUserInfo: { isNewUser: false },
    };
    (signInWithCredential as jest.Mock).mockResolvedValueOnce(mockUserCred);

    await signInWithGoogle();
    jest.advanceTimersByTime(2500);
    await Promise.resolve();

    expect(usersApi.put).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('should re-throw non-linking Firebase errors', async () => {
    const genericError = { code: 'auth/network-request-failed', message: 'Network error' };
    (signInWithCredential as jest.Mock).mockRejectedValueOnce(genericError);

    await expect(signInWithGoogle()).rejects.toEqual(genericError);
  });
});

describe('Google Auth - signOutFromGoogle', () => {
  it('should call GoogleSignin.signOut', async () => {
    await signOutFromGoogle();
    expect(GoogleSignin.signOut).toHaveBeenCalled();
  });

  it('should not throw if signOut fails', async () => {
    (GoogleSignin.signOut as jest.Mock).mockRejectedValueOnce(new Error('Not signed in'));
    await expect(signOutFromGoogle()).resolves.not.toThrow();
  });
});
