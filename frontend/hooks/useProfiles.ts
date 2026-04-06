import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profilesApi } from '../lib/api';

export interface CoreAttributes {
  strength: number;
  charisma: number;
  spark: number;
}

export interface Profile {
  profile_id: string;
  user_id: string;
  display_name: string;
  tagline?: string;
  bio?: string;
  character_class?: string;
  realm?: string;
  talents: string[];
  attributes: CoreAttributes;
  image_urls: string[];
  gender?: string;
}

/**
 * Custom hook to fetch all profiles from the Profiles service.
 * This will be used as a "random" discovery feed for now.
 * Conditional fetching via 'enabled' to prevent unauthorized requests.
 */
export function useAllProfiles(enabled: boolean = true) {
  return useQuery<Profile[]>({
    queryKey: ['profiles', 'all'],
    queryFn: async () => {
      const res = await profilesApi.get('/profiles/all');
      return res.data;
    },
    enabled,
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
