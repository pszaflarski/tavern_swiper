import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { profilesApi, discoveryApi, messagesApi } from '../lib/api';
import { Profile } from './useProfiles';

export interface Match {
  id: string;
  profiles: string[];
  created_at: string;
}

export interface Conversation {
  match_id: string;
  last_message: {
    content: string;
    sent_at: string;
    sender_profile_id: string;
  };
}

export interface UnifiedMatch extends Match {
  otherProfile: Profile | null;
  lastMessage?: Conversation['last_message'];
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

/**
 * Hook to fetch all conversations for a profile.
 */
export function useConversations(profileId: string | undefined) {
  return useQuery<Conversation[]>({
    queryKey: ['conversations', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const res = await messagesApi.get(`/messages/conversations/${profileId}`);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!profileId,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Orchestrator hook that combines matches, conversations, and profile details.
 * Splits them into "New Matches" (no messages) and "Inbox" (with messages).
 *
 * All derived values are memoized to prevent infinite re-render loops caused
 * by new array/object references on every render.
 */
export function useInvolvedMatches(profileId: string | undefined) {
  const { data: matches = [], isLoading: isLoadingMatches, refetch: refetchMatches } = useMatches(profileId);
  const { data: conversations = [], isLoading: isLoadingConvos, refetch: refetchConvos } = useConversations(profileId);

  // Memoize the batch key so it only changes when the actual match data changes.
  // Without this, sortedOtherIds and batchKey are new values every render,
  // which can cause the batch profile query to re-fire in a loop.
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

  const isLoading = isLoadingMatches || isLoadingConvos || (sortedOtherIds.length > 0 && isLoadingProfiles);

  const refetch = useCallback(async () => {
    await Promise.all([
      refetchMatches(),
      refetchConvos(),
      refetchProfiles(),
    ]);
  }, [refetchMatches, refetchConvos, refetchProfiles]);

  // Memoize the combined data so downstream components receive stable references.
  const { newMatches, inbox } = useMemo(() => {
    const combined = matches.map(match => {
      const otherId = match.profiles?.find(pid => pid !== profileId);
      const otherProfile = Array.isArray(profiles) ? profiles.find(p => p.profile_id === otherId) ?? null : null;
      const convo = Array.isArray(conversations) ? conversations.find(c => c.match_id === match.id) : undefined;

      return {
        ...match,
        otherProfile,
        lastMessage: convo?.last_message
      };
    });

    // Split into New Matches (no message) and Inbox (has message)
    const nm = combined.filter(m => !m.lastMessage);
    const ib = combined
      .filter(m => !!m.lastMessage)
      .sort((a, b) => {
        const timeA = new Date(a.lastMessage!.sent_at).getTime();
        const timeB = new Date(b.lastMessage!.sent_at).getTime();
        return timeB - timeA; // Newest first
      });

    return { newMatches: nm, inbox: ib };
  }, [matches, conversations, profiles, profileId]);

  return {
    newMatches,
    inbox,
    isLoading,
    refetch
  };
}
