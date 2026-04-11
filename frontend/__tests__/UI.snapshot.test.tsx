import React from 'react';
import { render } from '@testing-library/react-native';
import AuthScreen from '../app/auth';
import ProfilesScreen from '../app/(tabs)/profiles';
import TavernScreen from '../app/(tabs)/index';
import { useUser } from '../hooks/useUser';
import { useProfiles, useDiscoveryFeed } from '../hooks/useProfiles';
import { useProfileContext } from '../context/ProfileContext';
import { useSwipe } from '../hooks/useSwipe';

// Mock high-level hooks for snapshots to ensure deterministic structure
jest.mock('../hooks/useUser', () => ({
  useUser: jest.fn(() => ({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    refetch: jest.fn(),
  })),
}));

jest.mock('../hooks/useProfiles', () => ({
  useProfiles: jest.fn(() => ({ 
    data: [
        { profile_id: 'p1', display_name: 'Hero 1', bio: 'Bio 1' },
        { profile_id: 'p2', display_name: 'Hero 2', bio: 'Bio 2' },
    ], 
    isLoading: false,
    refetch: jest.fn(),
    isPending: false,
  })),
  useDiscoveryFeed: jest.fn(() => ({
    data: [{ profile_id: 'p1', display_name: 'Hero 1' }],
    isLoading: false,
    refetch: jest.fn(),
  })),
  useDeleteProfile: jest.fn(() => ({ mutate: jest.fn() })),
  useCreateProfile: jest.fn(() => ({ mutate: jest.fn() })),
  useUpdateProfile: jest.fn(() => ({ mutate: jest.fn() })),
}));

jest.mock('../hooks/useSwipe', () => ({
  useSwipe: jest.fn(() => ({ mutate: jest.fn() })),
}));

jest.mock('../context/ProfileContext', () => ({
  useProfileContext: jest.fn(() => ({
    activeProfileId: 'active-1',
    isLoadingActiveProfile: false,
    refetchActiveProfile: jest.fn(),
    refetchProfiles: jest.fn(),
    profiles: [
        { profile_id: 'active-1', display_name: 'Hero 1' },
    ],
  })),
}));

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

describe('UI Snapshots', () => {
  it('renders AuthScreen correctly', () => {
    const { toJSON } = render(<AuthScreen />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders ProfilesScreen correctly', () => {
    const { toJSON } = render(<ProfilesScreen />);
    expect(toJSON()).toMatchSnapshot();
  });

  it('renders TavernScreen correctly', () => {
    const { toJSON } = render(<TavernScreen />);
    expect(toJSON()).toMatchSnapshot();
  });
});
