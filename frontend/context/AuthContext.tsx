import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { getPersistedUid } from '../lib/api';

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  setFirebaseUser: (user: FirebaseUser | null) => void;
  persistedUid: string | null;
  setPersistedUid: (uid: string | null) => void;
  authInitialized: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(auth.currentUser);
  const [persistedUid, setPersistedUid] = useState<string | null>(null);
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    // 1. Initial hydration from AsyncStorage
    getPersistedUid().then((uid) => {
      if (uid) setPersistedUid(uid);
    });

    // 2. Firebase Auth listener
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('[AuthContext] Firebase auth state changed:', user?.email);
      setFirebaseUser(user);
      setAuthInitialized(true);
    });

    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ 
      firebaseUser, 
      setFirebaseUser, 
      persistedUid, 
      setPersistedUid, 
      authInitialized 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
