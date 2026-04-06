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
      return res.data.profiles;
    },
    enabled: enabled && !!profileId,
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
      return res.data;
    },
    enabled: !!userId,
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
  });
}
