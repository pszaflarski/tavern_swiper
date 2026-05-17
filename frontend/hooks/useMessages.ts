import { useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profilesApi, discoveryApi, messagesApi } from '../lib/api';
import { Profile } from './useProfiles';
import { MESSAGES } from '../constants';

export interface Match {
  id: string;
  profiles: string[];
  created_at: string;
}

export interface LastMessageInfo {
  content: string;
  sent_at: string;
  sender_profile_id?: string;
  type: string;
}

export interface Conversation {
  id: string;
  participant_ids: string[];
  other_profile_id?: string;
  last_message?: LastMessageInfo;
  created_at?: string;
  updated_at?: string;
  unread?: boolean;
}

export interface Message {
  message_id: string;
  conversation_id: string;
  sender_profile_id?: string;
  content: string;
  type: string;
  sent_at: string;
}

export interface PaginatedMessagesResponse {
  messages: Message[];
  has_more: boolean;
  oldest_timestamp?: string;
  newest_timestamp?: string;
}

export interface DiceRollResult {
  type: string;
  result: number;
  conversation_id?: string;
  message_id?: string;
}

export interface UnifiedMatch extends Match {
  otherProfile: Profile | null;
}

export interface UnifiedConversation extends Conversation {
  otherProfile: Profile | null;
}

/**
 * Hook to fetch all matches for a profile from Discovery service.
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
    staleTime: 0,
  });
}

/**
 * Hook to fetch all conversations for a profile from Messages service.
 */
export function useConversations(profileId: string | undefined) {
  return useQuery<Conversation[]>({
    queryKey: ['conversations', profileId],
    queryFn: async () => {
      if (!profileId) return [];
      const res = await messagesApi.get(`/messages/conversations/profile/${profileId}`);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!profileId,
    staleTime: 0,
  });
}

/**
 * Hook to fetch messages for a specific conversation with cursor-based pagination.
 * Loads the newest PAGE_SIZE messages initially, then lazy-loads older pages on demand.
 * Polls for new messages every POLL_INTERVAL_MS using the ?after= cursor.
 *
 * @param pausePolling When true, suppresses polling (e.g. during dice animations).
 */
export function useConversationMessages(
  conversationId: string | undefined,
  profileId: string | undefined,
  pausePolling: boolean = false,
) {
  const queryClient = useQueryClient();

  // Infinite query for paginated message loading
  const infiniteQuery = useInfiniteQuery<PaginatedMessagesResponse>({
    queryKey: ['messages', conversationId, profileId],
    queryFn: async ({ pageParam }) => {
      if (!conversationId) return { messages: [], has_more: false };
      const params = new URLSearchParams();
      if (profileId) params.set('profile_id', profileId);
      params.set('limit', String(MESSAGES.PAGE_SIZE));
      if (pageParam) params.set('before', pageParam as string);

      const res = await messagesApi.get(
        `/messages/conversations/${conversationId}/messages?${params}`
      );
      return res.data as PaginatedMessagesResponse;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.oldest_timestamp : undefined,
    enabled: !!conversationId,
  });

  // Flatten all pages into a single chronologically-sorted array.
  // Pages arrive newest-first but each page is internally ASC-sorted by the backend.
  // We merge them so oldest messages come first.
  const messages = useMemo(() => {
    if (!infiniteQuery.data?.pages) return [] as Message[];
    // Deduplicate by message_id (safety net for polling overlap)
    const seen = new Set<string>();
    const all: Message[] = [];
    for (const page of infiniteQuery.data.pages) {
      for (const msg of page.messages) {
        if (!seen.has(msg.message_id)) {
          seen.add(msg.message_id);
          all.push(msg);
        }
      }
    }
    return all.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  }, [infiniteQuery.data?.pages]);

  // Poll for NEW messages only (after the newest known timestamp).
  // This is much cheaper than refetching the entire first page.
  useEffect(() => {
    if (pausePolling || !conversationId || messages.length === 0) return;
    const newestTimestamp = messages[messages.length - 1]?.sent_at;
    if (!newestTimestamp) return;

    const interval = setInterval(async () => {
      try {
        const params = new URLSearchParams();
        if (profileId) params.set('profile_id', profileId);
        params.set('limit', String(MESSAGES.PAGE_SIZE));
        params.set('after', newestTimestamp);

        const res = await messagesApi.get(
          `/messages/conversations/${conversationId}/messages?${params}`
        );
        const pollData = res.data as PaginatedMessagesResponse;
        if (pollData.messages?.length > 0) {
          // Prepend new messages to the first page (newest page)
          queryClient.setQueryData(
            ['messages', conversationId, profileId],
            (old: any) => {
              if (!old?.pages?.[0]) return old;
              return {
                ...old,
                pages: [
                  {
                    ...old.pages[0],
                    messages: [...old.pages[0].messages, ...pollData.messages],
                    newest_timestamp: pollData.newest_timestamp ?? old.pages[0].newest_timestamp,
                  },
                  ...old.pages.slice(1),
                ],
              };
            }
          );
        }
      } catch (err) {
        // Silently swallow polling errors — the next interval will retry
      }
    }, MESSAGES.POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [pausePolling, conversationId, profileId, messages, queryClient]);

  return {
    data: messages,
    isLoading: infiniteQuery.isLoading,
    fetchNextPage: infiniteQuery.fetchNextPage,
    hasNextPage: !!infiniteQuery.hasNextPage,
    isFetchingNextPage: infiniteQuery.isFetchingNextPage,
  };
}

/**
 * Hook to send a message.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, senderProfileId, content }: { conversationId: string, senderProfileId: string, content: string }) => {
      const res = await messagesApi.post(`/messages/conversations/${conversationId}/messages`, {
        sender_profile_id: senderProfileId,
        content,
      });
      return res.data as Message;
    },
    onSuccess: (_, variables) => {
      // Invalidate messages for this conversation to trigger a refetch
      queryClient.invalidateQueries({ queryKey: ['messages', variables.conversationId] });
      // Also invalidate conversations list to update last message
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

/**
 * Hook to roll dice via the backend.
 * Returns the authoritative roll result so the frontend can animate it.
 * Does NOT auto-invalidate messages — the caller should call
 * invalidateAfterRoll() after the dice animation completes.
 */
export function useRollDice() {
  const queryClient = useQueryClient();
  const pendingConvIdRef = useRef<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ dieType, conversationId, profileId }: {
      dieType: string;
      conversationId: string;
      profileId: string;
    }) => {
      pendingConvIdRef.current = conversationId;
      const res = await messagesApi.post('/messages/roll-dice', {
        type: dieType,
        conversation_id: conversationId,
        profile_id: profileId,
      });
      return res.data as DiceRollResult;
    },
    // Deliberately no onSuccess invalidation — we delay it until animation ends
  });

  /**
   * Call this after the dice animation finishes to reveal the event message
   * that the backend already wrote to Firestore.
   */
  const invalidateAfterRoll = useCallback(() => {
    const convId = pendingConvIdRef.current;
    if (convId) {
      queryClient.invalidateQueries({ queryKey: ['messages', convId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      pendingConvIdRef.current = null;
    }
  }, [queryClient]);

  return { ...mutation, invalidateAfterRoll };
}

/**
 * Hook to initialize a conversation between two profiles.
 */
export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ participants }: { participants: string[] }) => {
      const res = await messagesApi.post('/messages/conversations', {
        participant_profile_ids: participants,
      });
      return res.data as { conversation_id: string };
    },
    onSuccess: () => {
      // Refresh conversations list
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
}

export function useInvolvedMatches(profileId: string | undefined) {
  const { data: matches = [], isLoading: isLoadingMatches, refetch: refetchMatches } = useMatches(profileId);
  const { data: conversations = [], isLoading: isLoadingConversations, refetch: refetchConversations } = useConversations(profileId);

  // Collect all unique profile IDs we need to fetch details for
  const batchKey = useMemo(() => {
    const matchOtherIds = matches
      .map(m => m.profiles.find(pid => pid !== profileId))
      .filter(Boolean) as string[];
    
    const convoOtherIds = conversations
      .map(c => c.other_profile_id)
      .filter(Boolean) as string[];
    
    // Deduplicate unique IDs
    const allUniqueIds = Array.from(new Set([...matchOtherIds, ...convoOtherIds]));
    return [...allUniqueIds].sort().join(',');
  }, [matches, conversations, profileId]);

  const sortedOtherIds = useMemo(() => batchKey ? batchKey.split(',') : [], [batchKey]);

  const { data: profiles = [], isLoading: isLoadingProfiles, refetch: refetchProfiles } = useQuery<Profile[]>({
    queryKey: ['profiles', 'batch', batchKey],
    queryFn: async () => {
      if (sortedOtherIds.length === 0) return [];
      const res = await profilesApi.post('/profiles/batch', { profile_ids: sortedOtherIds });
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: sortedOtherIds.length > 0,
    staleTime: 30000, // 30s buffer for scroll performance
  });

  const isLoading = isLoadingMatches || isLoadingConversations || (sortedOtherIds.length > 0 && isLoadingProfiles);

  const refetch = useCallback(async () => {
    await Promise.all([
      refetchMatches(),
      refetchConversations(),
      refetchProfiles(),
    ]);
  }, [refetchMatches, refetchConversations, refetchProfiles]);

  // Merge discovery matches and conversations with their full profiles.
  const { newMatches, inbox } = useMemo(() => {
    const enrichedMatches = matches.map(match => {
      const otherId = match.profiles?.find(pid => pid !== profileId);
      const otherProfile = Array.isArray(profiles) ? profiles.find(p => p.profile_id === otherId) ?? null : null;

      return {
        ...match,
        otherProfile
      };
    }).filter(m => !!m.otherProfile); // Filter out matches whose profiles aren't loaded yet

    const enrichedInbox = conversations.map(convo => {
      const otherProfile = Array.isArray(profiles) ? profiles.find(p => p.profile_id === convo.other_profile_id) ?? null : null;

      return {
        ...convo,
        otherProfile
      };
    }).filter(c => !!c.otherProfile);

    return { 
      newMatches: enrichedMatches, 
      inbox: enrichedInbox 
    };
  }, [matches, conversations, profiles, profileId]);

  return {
    newMatches,
    inbox,
    isLoading,
    refetch
  };
}

