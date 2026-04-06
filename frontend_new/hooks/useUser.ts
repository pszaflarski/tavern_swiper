import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../lib/api';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { useEffect, useState } from 'react';

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
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthInitialized(true);
      if (!user) {
        queryClient.setQueryData(['user', 'me'], null);
      }
    });
    return unsubscribe;
  }, [queryClient]);

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
    enabled: !!firebaseUser,
    retry: false,
  });

  return {
    user: userQuery.data,
    isLoading: !authInitialized || userQuery.isLoading,
    firebaseUser,
    isAuthenticated: !!firebaseUser,
  };
}
