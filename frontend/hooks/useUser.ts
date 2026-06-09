import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auth } from '../lib/firebase';
import { User as FirebaseUser } from 'firebase/auth';
import { usersApi, clearTavernSession } from '../lib/api';
import { signOutFromGoogle } from '../lib/googleAuth';
import { useAuthContext } from '../context/AuthContext';

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
  const { 
    firebaseUser, 
    setFirebaseUser, 
    persistedUid, 
    setPersistedUid, 
    authInitialized 
  } = useAuthContext();

  const activeUid = firebaseUser?.uid || persistedUid;

  const userQuery = useQuery<UserMetadata | null>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      try {
        const res = await usersApi.get('/users/me');
        return res.data;
      } catch (error: any) {
        throw error;
      }
    },
    enabled: !!activeUid,
    staleTime: 60000, 
    retry: (failureCount, error: any) => {
      if (failureCount < 3) return true;
      return false;
    },
    retryDelay: 1000,
  });

  const logout = async () => {
    console.log('[useUser] Initiating global logout...');
    try {
      // 1. Await external sign-outs to prevent race conditions
      await Promise.allSettled([
        signOutFromGoogle(),
        auth.signOut(),
      ]).then(() => console.log('[useUser] External sign-outs completed.'));

      // 2. Clear local Tavern session and cache
      await clearTavernSession();
      
      queryClient.clear();
      queryClient.setQueryData(['user', 'me'], null);
      
      // 3. Clear global context state immediately
      setFirebaseUser(null);
      setPersistedUid(null);
      
      console.log('[useUser] Global logout state cleared.');
    } catch (error) {
      console.error('[useUser] Logout failed:', error);
      setFirebaseUser(null);
      setPersistedUid(null);
    }
  };

  return {
    user: userQuery.data,
    uid: activeUid,
    isLoading: !authInitialized || (!!activeUid && !userQuery.data && !userQuery.isError),
    firebaseUser,
    isAuthenticated: !!firebaseUser || (!authInitialized && !!persistedUid),
    logout,
    refetch: userQuery.refetch,
  };
}
