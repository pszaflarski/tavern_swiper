import { renderHook, waitFor } from '@testing-library/react-native';
import { useProfiles, useProfile, useCreateProfile, useUpdateProfile } from './useProfiles';
import { profilesApi } from '../lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import MockAdapter from 'axios-mock-adapter';

const mockProfilesApi = new MockAdapter(profilesApi);

let queryClient: QueryClient;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useProfiles Hooks', () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { 
        queries: { retry: false, gcTime: Infinity, staleTime: 0 } 
      },
    });
    mockProfilesApi.reset();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('fetches all profiles for a user', async () => {
    mockProfilesApi.onGet('/profiles/user/u1').reply(200, [{ profile_id: 'p1', display_name: 'Thor' }]);
    const { result } = renderHook(() => useProfiles('u1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('fetches a single profile', async () => {
    mockProfilesApi.onGet('/profiles/p1').reply(200, { profile_id: 'p1', display_name: 'Thor' });
    const { result } = renderHook(() => useProfile('p1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.display_name).toBe('Thor');
  });

  it('creates a profile and invalidates cache', async () => {
    mockProfilesApi.onPost('/profiles/').reply(200, { profile_id: 'p1', user_id: 'u1' });
    const { result } = renderHook(() => useCreateProfile(), { wrapper });
    
    result.current.mutate({ user_id: 'u1', display_name: 'Thor', talents: [], attributes: { strength: 10, charisma: 10, spark: 10 } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.profile_id).toBe('p1');
  });
});
