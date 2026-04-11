import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import TavernScreen from '../app/(tabs)/index';
import { useDiscoveryFeed } from '../hooks/useProfiles';
import { useSwipe } from '../hooks/useSwipe';
import { useUser } from '../hooks/useUser';
import { useProfileContext } from '../context/ProfileContext';

// Mock hooks
jest.mock('../hooks/useProfiles', () => ({
  useDiscoveryFeed: jest.fn(),
  useProfiles: jest.fn(() => ({ data: [] })),
}));

jest.mock('../hooks/useSwipe', () => ({
  useSwipe: jest.fn(),
}));

jest.mock('../hooks/useUser', () => ({
  useUser: jest.fn(),
}));

jest.mock('../context/ProfileContext', () => ({
  useProfileContext: jest.fn(),
}));

// Mock SwipeDeck component
jest.mock('../components/SwipeDeck', () => {
    const { View, Text } = require('react-native');
    return ({ profiles }: any) => (
        <View testID="swipe-deck">
            {profiles.length > 0 && <Text testID="top-card-name">{profiles[0].display_name}</Text>}
        </View>
    );
});

describe('Detailed Profile View Edge Cases', () => {
  const mockSwipeMutate = jest.fn();
  const mockRefetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useUser as jest.Mock).mockReturnValue({ 
      user: { uid: 'test-user' }, 
      uid: 'test-user', 
      isAuthenticated: true, 
      isLoading: false,
      refetch: jest.fn(),
      logout: jest.fn(),
    });
    (useProfileContext as jest.Mock).mockReturnValue({ 
      activeProfileId: 'active-1', 
      isLoadingActiveProfile: false,
      refetchActiveProfile: jest.fn(),
      refetchProfiles: jest.fn(),
      profiles: [{ profile_id: 'active-1', display_name: 'Hero 1' }],
    });
    (useSwipe as jest.Mock).mockReturnValue({ mutate: mockSwipeMutate });
  });

  it('toggles the detailed view and closes on swipe', () => {
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: [{ profile_id: 'p1', display_name: 'Hero 1', bio: 'Short bio' }],
      isLoading: false, refetch: mockRefetch,
    });

    const { getByTestId, queryByText, getByText } = render(<TavernScreen />);
    
    // 1. Details should be hidden initially
    expect(queryByText('Short bio')).toBeNull();

    // 2. Open details
    const infoBtn = getByTestId('profile-info-button');
    fireEvent.press(infoBtn);
    expect(getByText('Short bio')).toBeTruthy();

    // 3. Swipe right (like)
    const rightBtn = getByTestId('swipe-right-button');
    fireEvent.press(rightBtn);

    // 4. Details should be closed (as handleSwipeRight resets setShowDetails)
    expect(queryByText('Short bio')).toBeNull();
  });

  it('handles extremely long bios and taglines correctly', () => {
    const longBio = "A".repeat(2000);
    const longTagline = "T".repeat(200);
    
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: [{ profile_id: 'p1', display_name: 'Epic Hero', bio: longBio, tagline: longTagline }],
      isLoading: false, refetch: mockRefetch,
    });

    const { getByTestId, getByText } = render(<TavernScreen />);
    
    // Open details
    fireEvent.press(getByTestId('profile-info-button'));
    
    // Verify content is rendered
    expect(getByText(longBio)).toBeTruthy();
    expect(getByText(`"${longTagline}"`)).toBeTruthy();
  });

  it('renders fallback text when bio is empty', () => {
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: [{ profile_id: 'p1', display_name: 'Silent Hero', bio: '', tagline: '...' }],
      isLoading: false, refetch: mockRefetch,
    });

    const { getByTestId, getByText } = render(<TavernScreen />);
    
    // Open details
    fireEvent.press(getByTestId('profile-info-button'));
    
    // Verify fallback text
    expect(getByText("This hero's story is yet to be written in the annals of the realm.")).toBeTruthy();
  });

  it('hides tagline section if it is missing', () => {
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: [{ profile_id: 'p1', display_name: 'Mysterious Hero', bio: 'Has a bio but no tagline' }],
      isLoading: false, refetch: mockRefetch,
    });

    const { getByTestId, queryByText } = render(<TavernScreen />);
    
    // Open details
    fireEvent.press(getByTestId('profile-info-button'));
    
    // It should not render any quotes if tagline is missing
    // Since our code is: {currentProfile?.tagline && <Text>"{currentProfile.tagline}"</Text>}
    const quotes = queryByText(/".*"/);
    expect(quotes).toBeNull();
  });
});
