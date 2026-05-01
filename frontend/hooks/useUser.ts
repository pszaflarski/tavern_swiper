import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { usersApi, clearTavernSession, getPersistedUid } from '../lib/api';
import { signOutFromGoogle } from '../lib/googleAuth';

export interface UserMetadata {
  uid: string;
  email: string;
  full_name?: string;
  is_premium: boolean;
  user_type: 'user' | 'admin' | 'root_admin';
  is_deleted: boolean;
  active_profile_id?: string;
  created_at: string;
}
export function useUser() {
  const queryClient = useQueryClient();
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
      setFirebaseUser(user);
      setAuthInitialized(true);
      if (!user) {
        queryClient.setQueryData(['user', 'me'], null);
      }
    });
    return unsubscribe;
  }, [queryClient]);

  const activeUid = firebaseUser?.uid || persistedUid;

  const userQuery = useQuery<UserMetadata | null>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      try {
        const res = await usersApi.get('/users/me');
        return res.data;
      } catch (error: any) {
        // If it's a 404, we throw the error to allow React Query to retry.
        // The backend self-healing logic might be in the middle of creating the record.
        throw error;
      }
    },
    enabled: !!activeUid,
    staleTime: 60000, // 1 minute (reduced from 15m)
    retry: (failureCount, error: any) => {
      // Retry up to 3 times on 404s or network errors
      if (failureCount < 3) return true;
      return false;
    },
    retryDelay: 1000,
  });

  const logout = async () => {
    try {
      await signOutFromGoogle();
      await auth.signOut();
      await clearTavernSession();
      queryClient.clear(); // Wipe all cached data (profiles, discovery, etc.)
      queryClient.setQueryData(['user', 'me'], null);
      setFirebaseUser(null);
      setPersistedUid(null);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return {
    user: userQuery.data,
    uid: activeUid,
    isLoading: !authInitialized || (!!activeUid && userQuery.isLoading && !userQuery.data),
    firebaseUser,
    isAuthenticated: !!firebaseUser || (!authInitialized && !!persistedUid),
    logout,
    refetch: userQuery.refetch,
  };
}
