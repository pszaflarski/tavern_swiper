import { useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profilesApi, discoveryApi, messagesApi } from '../lib/api';
import { Profile } from './useProfiles';

export interface Match {
  id: string;
  profiles: string[];
  created_at: string;
}

export interface LastMessageInfo {
  content: string;
  sent_at: string;
  sender_profile_id: string;
}

export interface Conversation {
  id: string;
  participant_ids: string[];
  other_profile_id?: string;
  last_message?: LastMessageInfo;
  created_at?: string;
  updated_at?: string;
}

export interface Message {
  message_id: string;
  conversation_id: string;
  sender_profile_id: string;
  content: string;
  sent_at: string;
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
    staleTime: 30000, // 30 seconds
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
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch messages for a specific conversation.
 */
export function useConversationMessages(conversationId: string | undefined) {
  return useQuery<Message[]>({
    queryKey: ['messages', conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const res = await messagesApi.get(`/messages/conversations/${conversationId}/messages`);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!conversationId,
    refetchInterval: 5000, // Poll every 5 seconds for "real-time" feel
  });
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
    staleTime: 120000, // 2 minutes
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

