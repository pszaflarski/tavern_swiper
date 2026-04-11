import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profilesApi, discoveryApi } from '../lib/api';

export interface Profile {
  profile_id: string;
  user_id: string;
  display_name: string;
  tagline?: string;
  bio?: string;
  image_urls: string[];
  gender?: string;
  is_active: boolean;
}

/**
 * Custom hook to fetch the discovery feed from the Discovery service.
 * Requires an active profile ID to filter out already-swiped profiles.
 */
export function useDiscoveryFeed(profileId: string | undefined, enabled: boolean = true, limit: number = 10) {
  return useQuery<Profile[]>({
    queryKey: ['discovery', 'feed', profileId, limit],
    queryFn: async () => {
      if (!profileId) return [];
      const res = await discoveryApi.get(`/discovery/feed/${profileId}?limit=${limit}`);
      // Discovery service returns { "profiles": [...] }
      return Array.isArray(res.data?.profiles) ? res.data.profiles : [];
    },
    enabled: enabled && !!profileId,
    staleTime: 120000, // 2 minutes
  });
}

/**
 * Fetch profiles for a specific user.
 */
export function useProfiles(userId: string | undefined) {
  return useQuery<Profile[]>({
    queryKey: ['profiles', 'user', userId],
    queryFn: async () => {
      const res = await profilesApi.get(`/profiles/user/${userId}`);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!userId,
    staleTime: 300000, // 5 minutes
  });
}

/**
 * Fetch the currently active profile for the authenticated user.
 */
export function useActiveProfile(enabled: boolean = true) {
  return useQuery<Profile>({
    queryKey: ['profiles', 'me', 'active'],
    queryFn: async () => {
      const res = await profilesApi.get('/profiles/user/me/active');
      return res.data;
    },
    enabled,
    staleTime: 300000, // 5 minutes
    retry: false, // If no active profile, 404 is expected, don't spam retries
  });
}

/**
 * Update a profile.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileId, data }: { profileId: string; data: Partial<Profile> }) => {
      const res = await profilesApi.put(`/profiles/${profileId}`, data);
      return res.data;
    },
    onSuccess: (_, variables) => {
      // Invalidate both 'all' and user-specific profiles to refresh UI
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (error) => {
      console.error('Profile update failed:', error);
    },
  });
}

/**
 * Create a new profile.
 */
export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Partial<Profile>) => {
      const res = await profilesApi.post('/profiles/', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (error) => {
      console.error('Profile creation failed:', error);
    },
  });
}

/**
 * Fetch a single profile by ID.
 */
export function useProfile(profileId: string | undefined) {
  return useQuery<Profile>({
    queryKey: ['profiles', 'id', profileId],
    queryFn: async () => {
      if (!profileId) throw new Error('Profile ID is required');
      const res = await profilesApi.get(`/profiles/${profileId}`);
      return res.data;
    },
    enabled: !!profileId,
    staleTime: 120000, // 2 minutes
  });
}

/**
 * Activate a specific profile for the user.
 * Implements optimistic updates for a snappy UI.
 */
export function useActivateProfile(userId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profileId: string) => {
      const res = await profilesApi.post(`/profiles/${profileId}/set_active`);
      return res.data;
    },
    // When mutate is called:
    onMutate: async (newProfileId: string) => {
      // 1. Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey: ['profiles', 'me', 'active'] });
      if (userId) {
        await queryClient.cancelQueries({ queryKey: ['profiles', 'user', userId] });
      }

      // 2. Snapshot the previous values
      const previousActiveProfile = queryClient.getQueryData<Profile>(['profiles', 'me', 'active']);
      const previousUserProfiles = userId 
        ? queryClient.getQueryData<Profile[]>(['profiles', 'user', userId])
        : undefined;

      // 3. Optimistically update to the new value
      
      // Update 'me/active' - find the profile from the list if possible, or just build a partial one
      if (previousUserProfiles) {
        const newActive = previousUserProfiles.find(p => p.profile_id === newProfileId);
        if (newActive) {
          queryClient.setQueryData(['profiles', 'me', 'active'], { ...newActive, is_active: true });
        }
      }

      // Update the user's profile list
      if (userId && previousUserProfiles) {
        queryClient.setQueryData(['profiles', 'user', userId], (old: Profile[] | undefined) => {
          if (!old) return old;
          return old.map(p => ({
            ...p,
            is_active: p.profile_id === newProfileId
          }));
        });
      }

      // Return a context object with the snapshotted values
      return { previousActiveProfile, previousUserProfiles };
    },
    // If the mutation fails, use the context we returned above
    onError: (err, newProfileId, context) => {
      if (context?.previousActiveProfile) {
        queryClient.setQueryData(['profiles', 'me', 'active'], context.previousActiveProfile);
      }
      if (userId && context?.previousUserProfiles) {
        queryClient.setQueryData(['profiles', 'user', userId], context.previousUserProfiles);
      }
    },
    // Always refetch after error or success:
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles', 'me', 'active'] });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ['profiles', 'user', userId] });
      }
      // Also invalidate discovery since the active profile changed
      queryClient.invalidateQueries({ queryKey: ['discovery'] });
    },
  });
}

/**
 * Delete a profile.
 */
export function useDeleteProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (profileId: string) => {
      await profilesApi.delete(`/profiles/${profileId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
    },
    onError: (error) => {
      console.error('Profile deletion failed:', error);
    },
  });
}

/**
 * Upload a profile image for a specific index.
 */
export function useUploadProfileImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileId, index, file }: { profileId: string; index: number; file: Blob | File }) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await profilesApi.post(`/profiles/${profileId}/image?index=${index}`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['profiles', 'id', variables.profileId] });
      queryClient.invalidateQueries({ queryKey: ['profiles', 'user'] });
      queryClient.invalidateQueries({ queryKey: ['profiles', 'me', 'active'] });
    },
    onError: (error, variables) => {
      console.error(`Image upload failed for profile ${variables.profileId}, index ${variables.index}:`, error);
    },
  });
}
