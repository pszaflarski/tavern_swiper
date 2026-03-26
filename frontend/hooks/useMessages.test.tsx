import { renderHook, waitFor } from '@testing-library/react-native';
import { useMessages, useSendMessage } from './useMessages';
import { messagesApi } from '../lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import MockAdapter from 'axios-mock-adapter';

const mockMessagesApi = new MockAdapter(messagesApi);

const queryClient = new QueryClient({
  defaultOptions: { 
    queries: { retry: false, gcTime: 0, staleTime: 0 } 
  },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useMessages Hooks', () => {
  beforeEach(() => {
    queryClient.clear();
    mockMessagesApi.reset();
  });

  afterAll(() => {
    queryClient.clear();
  });

  it('fetches messages for a match', async () => {
    mockMessagesApi.onGet('/messages/match-123').reply(200, [{ message_id: 'msg1', content: 'Hello' }]);
    const { result } = renderHook(() => useMessages('match-123'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].content).toBe('Hello');
  });

  it('sends a message and resolves', async () => {
    mockMessagesApi.onPost('/messages/').reply(200, { message_id: 'msg2', content: 'Hi' });
    const { result } = renderHook(() => useSendMessage(), { wrapper });
    
    result.current.mutate({ matchId: 'match-123', senderProfileId: 'me', content: 'Hi' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.content).toBe('Hi');
  });
});
