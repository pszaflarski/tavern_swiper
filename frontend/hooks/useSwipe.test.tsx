import { renderHook, waitFor } from '@testing-library/react-native';
import { useSwipe, useMatches } from './useSwipe';
import { swipesApi } from '../lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import MockAdapter from 'axios-mock-adapter';

const mockSwipesApi = new MockAdapter(swipesApi);

let queryClient: QueryClient;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useSwipe Hooks', () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { 
        queries: { retry: false, gcTime: Infinity, staleTime: 0 } 
      },
    });
    mockSwipesApi.reset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('records a swipe', async () => {
    mockSwipesApi.onPost('/swipes/').reply(200, { swipe_id: 's1', direction: 'right' });
    const { result } = renderHook(() => useSwipe('me'), { wrapper });
    
    result.current.mutate({ swipedProfileId: 'them', direction: 'right' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.direction).toBe('right');
  });

  it('fetches matches', async () => {
    mockSwipesApi.onGet('/swipes/matches/me').reply(200, [{ match_id: 'm1', profile_id_a: 'me', profile_id_b: 'them' }]);
    const { result } = renderHook(() => useMatches('me'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].match_id).toBe('m1');
  });
});
