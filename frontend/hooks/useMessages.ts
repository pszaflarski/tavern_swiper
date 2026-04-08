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
      return res.data;
    },
    enabled: !!profileId,
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
      return res.data;
    },
    enabled: !!profileId,
  });
}

/**
 * Orchestrator hook that combines matches, conversations, and profile details.
 * Splits them into "New Matches" (no messages) and "Inbox" (with messages).
 */
export function useInvolvedMatches(profileId: string | undefined) {
  const { data: matches = [], isLoading: isLoadingMatches } = useMatches(profileId);
  const { data: conversations = [], isLoading: isLoadingConvos } = useConversations(profileId);

  // Fetch all "other" profile IDs
  const otherProfileIds = matches.map(m => 
    m.profiles.find(pid => pid !== profileId)
  ).filter(Boolean) as string[];

  // Batch fetch profile details
  const { data: profiles = [], isLoading: isLoadingProfiles } = useQuery<Profile[]>({
    queryKey: ['profiles', 'batch', otherProfileIds],
    queryFn: async () => {
      if (otherProfileIds.length === 0) return [];
      const res = await profilesApi.post('/profiles/batch', { profile_ids: otherProfileIds });
      return res.data;
    },
    enabled: otherProfileIds.length > 0,
  });

  const isLoading = isLoadingMatches || isLoadingConvos || isLoadingProfiles;

  // Combine data
  const combined = matches.map(match => {
    const otherId = match.profiles.find(pid => pid !== profileId);
    const otherProfile = profiles.find(p => p.profile_id === otherId) || null;
    const convo = conversations.find(c => c.match_id === match.id);
    
    return {
      ...match,
      otherProfile,
      lastMessage: convo?.last_message
    };
  });

  // Split into New Matches (no message) and Inbox (has message)
  const newMatches = combined.filter(m => !m.lastMessage);
  const inbox = combined
    .filter(m => !!m.lastMessage)
    .sort((a, b) => {
      const timeA = new Date(a.lastMessage!.sent_at).getTime();
      const timeB = new Date(b.lastMessage!.sent_at).getTime();
      return timeB - timeA; // Newest first
    });

  return {
    newMatches,
    inbox,
    isLoading
  };
}
