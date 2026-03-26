/* eslint-disable no-undef */

export const auth = {
  currentUser: {
    uid: 'test-uid-123',
    email: 'test@example.com',
    displayName: 'Test User',
    getIdToken: () => Promise.resolve('mock-token'),
  },
  onAuthStateChanged: (authInstance: any, callback: (user: any) => void) => {
    callback({
      uid: 'test-uid-123',
      email: 'test@example.com',
      displayName: 'Test User',
      getIdToken: () => Promise.resolve('mock-token'),
    });
    return () => {}; // unsubscribe
  },
};

export const getAuth = () => auth;
export const initializeApp = () => {};
export const getApps = () => [];
export const getApp = () => ({});
