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
  created_at: string;
}

/**
 * useUser hook - Manages the global account state.
 * Syncs Firebase Auth with our User Microservice.
 */
export function useUser() {
  const queryClient = useQueryClient();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(auth.currentUser);

  // Listen for auth changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
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

  // Effect to trigger registration
  useEffect(() => {
    if (userQuery.isSuccess && !userQuery.data && firebaseUser && !registerMutation.isPending) {
      registerMutation.mutate();
    }
  }, [userQuery.isSuccess, userQuery.data, firebaseUser]);

  return {
    user: userQuery.data,
    isLoading: userQuery.isLoading || registerMutation.isPending,
    firebaseUser,
    isAuthenticated: !!firebaseUser,
  };
}
