import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { profilesApi } from '../../lib/api';
import { useProfiles, useCreateProfile, useUpdateProfile } from '../useProfiles';
import React from 'react';

// Create a mock adapter for the profilesApi axios instance
const mock = new MockAdapter(profilesApi);

let queryClient: QueryClient;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useProfiles Hook', () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
        },
      },
    });
  });

  afterEach(() => {
    mock.reset();
    queryClient.clear();
  });

  it('fetches profiles for a given user', async () => {
    const userId = 'user-123';
    const mockProfiles = [
      {
        profile_id: 'p1',
        user_id: userId,
        display_name: 'Gimli',
        gender: 'Masculine',
        attributes: { strength: 18, charisma: 8, spark: 10 },
        talents: [],
      },
    ];

    mock.onGet(`/profiles/user/${userId}`).reply(200, mockProfiles);

    const { result } = renderHook(() => useProfiles(userId), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockProfiles);
  });

  it('creates a new profile successfully', async () => {
    const newProfile = {
      user_id: 'user-123',
      display_name: 'Legolas',
      gender: 'Feminine',
      attributes: { strength: 12, charisma: 18, spark: 15 },
      talents: ['Archery'],
    };

    const createdProfile = { ...newProfile, profile_id: 'p2' };

    mock.onPost('/profiles/').reply(201, createdProfile);

    const { result } = renderHook(() => useCreateProfile(), { wrapper });

    result.current.mutate(newProfile);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(createdProfile);
  });

  it('updates an existing profile', async () => {
    const profileId = 'p1';
    const updateData = { display_name: 'Gimli the Stout' };
    const updatedProfile = { 
        profile_id: profileId, 
        user_id: 'u1', 
        display_name: 'Gimli the Stout',
        attributes: { strength: 20, charisma: 10, spark: 5 },
        talents: []
    };

    mock.onPut(`/profiles/${profileId}`).reply(200, updatedProfile);

    const { result } = renderHook(() => useUpdateProfile(), { wrapper });

    result.current.mutate({ profileId, data: updateData });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.display_name).toBe('Gimli the Stout');
  });
});
