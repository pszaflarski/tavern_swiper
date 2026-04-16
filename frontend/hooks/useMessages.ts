import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { profilesApi, discoveryApi } from '../lib/api';
import { Profile } from './useProfiles';

export interface Match {
  id: string;
  profiles: string[];
  created_at: string;
}

// Conversation interface removed as Messages service is being refactored.

export interface UnifiedMatch extends Match {
  otherProfile: Profile | null;
  lastMessage?: any; // Placeholder for future refactor
}

/**
 * Hook to fetch all matches for a profile.
 */
export function useMatches(profileId: string | undefined) {
  return useQuery<Match[]>({
    queryKey: ['matches', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const res = await discoveryApi.get(`/discovery/matches/profile/${profileId}`);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!profileId,
    staleTime: 30000, // 30 seconds
  });
}

// useConversations hook removed as Messages service is being refactored.

export function useInvolvedMatches(profileId: string | undefined) {
  const { data: matches = [], isLoading: isLoadingMatches, refetch: refetchMatches } = useMatches(profileId);

  // Memoize the batch key so it only changes when the actual match data changes.
  const batchKey = useMemo(() => {
    const otherIds = matches
      .map(m => m.profiles.find(pid => pid !== profileId))
      .filter(Boolean) as string[];
    return [...otherIds].sort().join(',');
  }, [matches, profileId]);

  const sortedOtherIds = useMemo(() => batchKey ? batchKey.split(',') : [], [batchKey]);

  const { data: profiles = [], isLoading: isLoadingProfiles, refetch: refetchProfiles } = useQuery<Profile[]>({
    queryKey: ['profiles', 'batch', batchKey],
    queryFn: async () => {
      if (sortedOtherIds.length === 0) return [];
      const res = await profilesApi.post('/profiles/batch', { profile_ids: sortedOtherIds });
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: sortedOtherIds.length > 0,
    staleTime: 120000, // 2 minutes
  });

  const isLoading = isLoadingMatches || (sortedOtherIds.length > 0 && isLoadingProfiles);

  const refetch = useCallback(async () => {
    await Promise.all([
      refetchMatches(),
      refetchProfiles(),
    ]);
  }, [refetchMatches, refetchProfiles]);

  // Merge discovery matches with their full profiles.
  // Inbox is temporarily disabled while Messages service is being refactored.
  const { newMatches, inbox } = useMemo(() => {
    const combined = matches.map(match => {
      const otherId = match.profiles?.find(pid => pid !== profileId);
      const otherProfile = Array.isArray(profiles) ? profiles.find(p => p.profile_id === otherId) ?? null : null;

      return {
        ...match,
        otherProfile,
        lastMessage: undefined // Messages disabled
      };
    });

    return { 
      newMatches: combined, 
      inbox: [] 
    };
  }, [matches, profiles, profileId]);

  return {
    newMatches,
    inbox,
    isLoading,
    refetch
  };
}
