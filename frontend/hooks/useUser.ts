import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { usersApi, clearTavernSession, getPersistedUid } from '../lib/api';

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
        if (error.response?.status === 404) return null;
        throw error;
      }
    },
    enabled: !!activeUid,
    staleTime: 900000, // 15 minutes
    retry: false,
  });

  const logout = async () => {
    try {
      await auth.signOut();
      await clearTavernSession();
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
    isAuthenticated: !!firebaseUser || !!persistedUid,
    logout,
  };
}
