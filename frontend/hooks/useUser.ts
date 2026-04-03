import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../lib/api';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from '@firebase/auth';
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

/**
 * useUser hook - Manages the global account state.
 * Syncs Firebase Auth with our User Microservice.
 */
export function useUser() {
  const queryClient = useQueryClient();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(auth.currentUser);
  const [authInitialized, setAuthInitialized] = useState(!!auth.currentUser);

  // Listen for auth changes
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

  // Fetch user metadata from our backend
  const userQuery = useQuery<UserMetadata | null>({
    queryKey: ['user', 'me'],
    queryFn: async () => {
      try {
        const res = await usersApi.get('/users/me');
        return res.data;
      } catch (error: any) {
        if (error.response?.status === 404) {
          return null; // User doesn't exist in our DB yet
        }
        throw error;
      }
    },
    enabled: !!firebaseUser,
    retry: false,
  });

  // Automatically register user if they don't exist
  const registerMutation = useMutation({
    mutationFn: async () => {
      if (!firebaseUser) return;
      const res = await usersApi.post('/users/', {
        email: firebaseUser.email,
        full_name: firebaseUser.displayName || '',
        is_premium: false,
      });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['user', 'me'], data);
    },
  });

  // Check if root admin exists
  const rootExistsQuery = useQuery({
    queryKey: ['admin', 'root-exists'],
    queryFn: async () => {
      const res = await usersApi.get('/users/root-admin-exists');
      return res.data.exists;
    },
    staleTime: Infinity, // Only need to check once per session usually
  });

  // Effect to trigger registration
  useEffect(() => {
    // Structural Fix: If root-admin doesn't exist, we must PAUSE automatic registration.
    // This allows the specialized "Claim the Root" flow in AdminDashboard to handle 
    // the first user creation with the correct 'root_admin' type.
    if (rootExistsQuery.data !== true) {
      console.log('[USER HOOK DEBUG] Root existence unknown or false. Skipping auto-registration.');
      return;
    }

    if (userQuery.isSuccess && !userQuery.data && firebaseUser && !registerMutation.isPending) {
        registerMutation.mutate();
    }
  }, [userQuery.isSuccess, userQuery.data, firebaseUser, rootExistsQuery.data]);

  return {
    user: userQuery.data,
    isLoading: !authInitialized || userQuery.isLoading || registerMutation.isPending || rootExistsQuery.isLoading,
    firebaseUser,
    isAuthenticated: !!firebaseUser,
    rootExists: rootExistsQuery.data ?? true,
  };
}
