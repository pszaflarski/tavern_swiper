import { useQueries } from '@tanstack/react-query';
import { useProfileContext } from '../context/ProfileContext';
import { messagesApi } from '../lib/api';
import { Conversation } from './useMessages';

/**
 * Returns unread status across all of the current user's profiles.
 *
 * - hasAnyUnread: true if ANY profile has ANY unread conversation (Level 1)
 * - unreadByProfile: Map<profileId, boolean> (Level 2)
 */
export function useUnreadStatus() {
  const { profiles } = useProfileContext();

  // useQueries allows us to dynamically fetch conversations for a variable number of profiles
  // without violating the Rules of Hooks.
  const queryResults = useQueries({
    queries: profiles.map(p => ({
      queryKey: ['conversations', p.profile_id],
      queryFn: async () => {
        const res = await messagesApi.get(`/messages/conversations/profile/${p.profile_id}`);
        return Array.isArray(res.data) ? res.data : [];
      },
      staleTime: 0,
    }))
  });

  const unreadByProfile: Record<string, boolean> = {};
  let hasAnyUnread = false;

  profiles.forEach((p, index) => {
    const result = queryResults[index];
    const data = (result.data as Conversation[] | undefined) ?? [];
    
    const hasUnread = data.some((c: Conversation) => c.unread === true);
    unreadByProfile[p.profile_id] = hasUnread;
    if (hasUnread) hasAnyUnread = true;
  });

  return { hasAnyUnread, unreadByProfile };
}
