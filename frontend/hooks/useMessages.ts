import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { messagesApi } from '../lib/api';

export interface Message {
  message_id: string;
  match_id: string;
  sender_profile_id: string;
  content: string;
  sent_at: string;
}

export function useMessages(matchId: string | undefined) {
  return useQuery<Message[]>({
    queryKey: ['messages', matchId],
    queryFn: async () => {
      const res = await messagesApi.get(`/messages/${matchId}`);
      return res.data;
    },
    enabled: !!matchId,
    refetchInterval: 5_000, // Poll every 5s while in a chat
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation<
    Message,
    Error,
    { matchId: string; senderProfileId: string; content: string }
  >({
    mutationFn: async ({ matchId, senderProfileId, content }) => {
      const res = await messagesApi.post('/messages/', {
        match_id: matchId,
        sender_profile_id: senderProfileId,
        content,
      });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['messages', data.match_id] });
    },
  });
}
