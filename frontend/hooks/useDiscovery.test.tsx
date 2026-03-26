import { renderHook, waitFor } from '@testing-library/react-native';
import { useDiscovery } from './useDiscovery';
import { discoveryApi } from '../lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import MockAdapter from 'axios-mock-adapter';

const mockDiscoveryApi = new MockAdapter(discoveryApi);

const queryClient = new QueryClient({
  defaultOptions: { 
    queries: { retry: false, gcTime: 0, staleTime: 0 } 
  },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useDiscovery Hook', () => {
  beforeEach(() => {
    queryClient.clear();
    mockDiscoveryApi.reset();
  });

  afterAll(() => {
    queryClient.clear();
  });

  it('fetches discovery feed successfully', async () => {
    const mockProfiles = [
      { profile_id: 'p1', display_name: 'Gimli', talents: [] }
    ];
    
    mockDiscoveryApi.onGet('/discovery/feed/my-profile').reply(200, { profiles: mockProfiles });

    const { result } = renderHook(() => useDiscovery('my-profile'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.profiles).toHaveLength(1);
    expect(result.current.data?.profiles[0].display_name).toBe('Gimli');
  });

  it('does not fetch if profileId is undefined', () => {
    const { result } = renderHook(() => useDiscovery(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
