import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import SharedProfileScreen from '../../screens/SharedProfileScreen';
import { useSharedProfile, useUnshareProfile, useClaimProfile } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';

// Mock hooks
jest.mock('../../hooks/useProfiles', () => ({
  useSharedProfile: jest.fn(),
  useUnshareProfile: jest.fn(),
  useClaimProfile: jest.fn(),
}));

jest.mock('../../hooks/useUser', () => ({
  useUser: jest.fn(),
}));

jest.mock('expo-router', () => {
  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  };
  return {
    router: mockRouter,
    useRouter: () => mockRouter,
    useLocalSearchParams: jest.fn(),
    Stack: {
      Screen: jest.fn(() => null),
    },
  };
});

// Mock Toast
jest.mock('react-native-toast-message', () => ({
  show: jest.fn(),
}));

// Mock SwipeDeck component to render action triggers
jest.mock('../../components/SwipeDeck', () => {
  const { View, Text, Button } = require('react-native');
  return ({ profiles, onSwipeLeft, onSwipeRight }: any) => (
    <View testID="mock-swipe-deck">
      {profiles.length > 0 && (
        <>
          <Text testID="profile-name">{profiles[0].display_name}</Text>
          <Button title="Swipe Left" onPress={() => onSwipeLeft(profiles[0].profile_id)} testID="swipe-left-trigger" />
          <Button title="Swipe Right" onPress={() => onSwipeRight(profiles[0].profile_id)} testID="swipe-right-trigger" />
        </>
      )}
    </View>
  );
});

describe('Shared Profile Screen', () => {
  const mockProfile = {
    profile_id: 'shared-p1',
    display_name: 'Alistair the Mage',
    bio: 'Keeper of ancient runes',
    image_urls: ['http://example.com/alistair.jpg'],
    shared_at: '2026-07-02T12:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'shared-p1' });
    (useUser as jest.Mock).mockReturnValue({
      user: null,
      uid: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  it('renders loading state when ID is not parsed or query is loading', () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '[id]' });
    (useSharedProfile as jest.Mock).mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
    });

    const { getByText } = render(<SharedProfileScreen />);
    expect(getByText('Seeking the shared identity...')).toBeTruthy();
  });

  it('renders error screen if profile is not shared or returns 404', () => {
    (useSharedProfile as jest.Mock).mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
    });

    const { getByText, getByTestId } = render(<SharedProfileScreen />);
    expect(getByTestId('shared-profile-error')).toBeTruthy();
    expect(getByText('This Legend Has Faded')).toBeTruthy();
  });

  it('renders shared profile deck card successfully when loaded', () => {
    (useSharedProfile as jest.Mock).mockReturnValue({
      data: mockProfile,
      isLoading: false,
      isError: false,
    });

    const { getByText, getByTestId } = render(<SharedProfileScreen />);
    expect(getByTestId('shared-profile-screen')).toBeTruthy();
    expect(getByText('Alistair the Mage', { exact: false })).toBeTruthy();
  });

  it('wipes sharing status (banishes) when user swipes left', async () => {
    const mockUnshare = jest.fn((id, config) => config.onSuccess());
    (useSharedProfile as jest.Mock).mockReturnValue({
      data: mockProfile,
      isLoading: false,
      isError: false,
    });
    (useUnshareProfile as jest.Mock).mockReturnValue({
      mutate: mockUnshare,
    });

    const { getByTestId } = render(<SharedProfileScreen />);
    const leftTrigger = getByTestId('swipe-left-trigger');
    fireEvent.press(leftTrigger);

    expect(mockUnshare).toHaveBeenCalledWith('shared-p1', expect.any(Object));
    
    // Should now show banished screen
    await waitFor(() => {
      expect(getByTestId('shared-profile-banished')).toBeTruthy();
    });
  });

  it('claims profile immediately when swiping right if authenticated', async () => {
    const mockClaim = jest.fn((id, config) => config.onSuccess());
    (useUser as jest.Mock).mockReturnValue({
      user: { uid: 'auth-user-1' },
      uid: 'auth-user-1',
      isAuthenticated: true,
      isLoading: false,
    });
    (useSharedProfile as jest.Mock).mockReturnValue({
      data: mockProfile,
      isLoading: false,
      isError: false,
    });
    (useClaimProfile as jest.Mock).mockReturnValue({
      mutate: mockClaim,
    });

    const { getByTestId } = render(<SharedProfileScreen />);
    const rightTrigger = getByTestId('swipe-right-trigger');
    fireEvent.press(rightTrigger);

    expect(mockClaim).toHaveBeenCalledWith('shared-p1', expect.any(Object));

    // Should now show claimed screen
    await waitFor(() => {
      expect(getByTestId('shared-profile-claimed')).toBeTruthy();
    });
  });

  it('caches profile ID in AsyncStorage and redirects to auth if unauthenticated when swiping right', async () => {
    jest.useFakeTimers();
    (useSharedProfile as jest.Mock).mockReturnValue({
      data: mockProfile,
      isLoading: false,
      isError: false,
    });

    const mockRouter = require('expo-router').router;

    const { getByTestId } = render(<SharedProfileScreen />);
    const rightTrigger = getByTestId('swipe-right-trigger');
    fireEvent.press(rightTrigger);

    // Should set item in storage and show toast
    await waitFor(() => {
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('pending_claim_profile_id', 'shared-p1');
      expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({
        type: 'info',
        text1: 'Enter the Tavern',
      }));
    });

    // Should trigger redirect after timeout
    act(() => {
      jest.runAllTimers();
    });
    expect(mockRouter.replace).toHaveBeenCalledWith('/auth');
    jest.useRealTimers();
  });
});
