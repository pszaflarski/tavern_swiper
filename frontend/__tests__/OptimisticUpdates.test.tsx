import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
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

jest.mock('../context/MatchContext', () => ({
  useMatch: jest.fn(() => ({
    showMatch: jest.fn(),
    hideMatch: jest.fn(),
    clearMatchedProfile: jest.fn(),
    isMatchVisible: false,
    matchedProfile: null,
  })),
}));

jest.mock('../components/SwipeDeck', () => {
    const { View, Text } = require('react-native');
    return ({ profiles }: any) => (
        <View testID="swipe-deck">
            {profiles.length > 0 && <Text testID="top-card-name">{profiles[0].display_name}</Text>}
        </View>
    );
});

describe('Optimistic UI Updates', () => {
  it('updates the tavern feed index immediately upon swiping', async () => {
    const mockSwipeMutate = jest.fn();
    (useUser as jest.Mock).mockReturnValue({ 
      isAuthenticated: true, 
      isLoading: false, 
      refetch: jest.fn(), 
      uid: 'u1' 
    });
    (useProfileContext as jest.Mock).mockReturnValue({ 
      activeProfileId: 'a1', 
      isLoadingActiveProfile: false,
      refetchActiveProfile: jest.fn(),
      refetchProfiles: jest.fn(),
      profiles: [{ profile_id: 'a1', display_name: 'Hero 1' }],
    });
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: [
        { profile_id: 'p1', display_name: 'Hero 1' },
        { profile_id: 'p2', display_name: 'Hero 2' },
      ],
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    });
    (useSwipe as jest.Mock).mockReturnValue({ mutate: mockSwipeMutate });

    const { getByTestId, getByText, queryByText } = render(<TavernScreen />);
    
    // Initially showing Hero 1
    expect(getByText('Hero 1')).toBeTruthy();
    
    // Press swipe button
    fireEvent.press(getByTestId('swipe-right-button'));
    
    // Should IMMEDIATELY show Hero 2 (optimistic index update)
    expect(queryByText('Hero 1')).toBeNull();
    expect(getByText('Hero 2')).toBeTruthy();
    
    // Mutation should have been called
    expect(mockSwipeMutate).toHaveBeenCalled();
  });
});
