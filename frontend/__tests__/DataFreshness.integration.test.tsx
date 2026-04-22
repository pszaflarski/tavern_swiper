import { render, waitFor, screen } from '@testing-library/react-native';
import TavernScreen from '../app/(tabs)/index';
import { useDiscoveryFeed, useActiveProfile, useProfiles } from '../hooks/useProfiles';
import { useFocusEffect } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileProvider } from '../context/ProfileContext';
import { MatchProvider } from '../context/MatchContext';
import React from 'react';

// Mock axios since it causes stream issues in RN/Jest env
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  })),
  post: jest.fn(),
  get: jest.fn(),
}));

// Mock the hooks to track refetch calls
jest.mock('../hooks/useProfiles', () => ({
  useDiscoveryFeed: jest.fn(),
  useActiveProfile: jest.fn(),
  useProfiles: jest.fn(),
  useActivateProfile: jest.fn(() => ({ mutate: jest.fn() })),
}));
jest.mock('../hooks/useUser', () => ({
  useUser: () => ({
    user: { uid: 'test-user' },
    uid: 'test-user',
    isAuthenticated: true,
    isLoading: false,
    refetch: jest.fn(),
  }),
}));

describe('DataFreshness Integration', () => {
  let queryClient: QueryClient;
  const mockRefetchDiscovery = jest.fn();
  const mockRefetchActiveProfile = jest.fn();
  const mockRefetchProfiles = jest.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    jest.clearAllMocks();

    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: [],
      isFetching: false,
      refetch: mockRefetchDiscovery,
    });
    (useActiveProfile as jest.Mock).mockReturnValue({
      data: { profile_id: 'p1', display_name: 'Hero 1' },
      isLoading: false,
      refetch: mockRefetchActiveProfile,
    });
    (useProfiles as jest.Mock).mockReturnValue({
      data: [{ profile_id: 'p1', display_name: 'Hero 1' }],
      isFetching: false,
      refetch: mockRefetchProfiles,
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ProfileProvider>
        <MatchProvider>
          {children}
        </MatchProvider>
      </ProfileProvider>
    </QueryClientProvider>
  );

  it('discovery screen should trigger refetch on focus', async () => {
    // Capture the focus effect callback
    let focusEffectCallback: () => void = () => {};
    (useFocusEffect as jest.Mock).mockImplementation((cb) => {
      focusEffectCallback = cb;
    });

    render(<TavernScreen />, { wrapper });

    // Simulate focus
    focusEffectCallback();

    // Verify all relevant refetches were called
    expect(mockRefetchActiveProfile).toHaveBeenCalled();
    expect(mockRefetchProfiles).toHaveBeenCalled();
    expect(mockRefetchDiscovery).toHaveBeenCalled();
  });

  it('discovery screen should gate content if no profiles exist', async () => {
    // Mock no profiles
    (useProfiles as jest.Mock).mockReturnValue({
      data: [],
      isFetching: false,
      refetch: mockRefetchProfiles,
    });
    (useActiveProfile as jest.Mock).mockReturnValue({
      data: null,
      isLoading: false,
      refetch: mockRefetchActiveProfile,
    });

    render(<TavernScreen />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/Forge Your First Identity/i)).toBeTruthy();
      expect(screen.getByText(/You must forge an identity/i)).toBeTruthy();
    });
  });
});
