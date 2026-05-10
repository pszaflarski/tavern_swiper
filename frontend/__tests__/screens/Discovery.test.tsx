import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import TavernScreen from '../../screens/DiscoveryScreen';
import { useDiscoveryFeed } from '../../hooks/useProfiles';
import { useSwipe } from '../../hooks/useSwipe';
import { useUser } from '../../hooks/useUser';
import { useProfileContext } from '../../context/ProfileContext';

// Mock hooks
jest.mock('../../hooks/useProfiles', () => ({
  useDiscoveryFeed: jest.fn(),
  useProfiles: jest.fn(() => ({ data: [] })),
}));

jest.mock('../../hooks/useSwipe', () => ({
  useSwipe: jest.fn(),
}));

jest.mock('../../hooks/useUser', () => ({
  useUser: jest.fn(),
}));

jest.mock('../../context/ProfileContext', () => ({
  useProfileContext: jest.fn(),
}));

jest.mock('../../context/MatchContext', () => ({
  useMatch: jest.fn(() => ({
    showMatch: jest.fn(),
    hideMatch: jest.fn(),
    clearMatchedProfile: jest.fn(),
    isMatchVisible: false,
    matchedProfile: null,
  })),
}));

// Mock SwipeDeck component
jest.mock('../../components/SwipeDeck', () => {
    const { View, Text } = require('react-native');
    return ({ profiles }: any) => (
        <View testID="swipe-deck">
            {profiles.length > 0 && <Text testID="top-card-name">{profiles[0].display_name}</Text>}
        </View>
    );
});

describe('Tavern (Swiping) Screen', () => {
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
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: [
        { profile_id: 'p1', display_name: 'Hero 1' },
        { profile_id: 'p2', display_name: 'Hero 2' },
      ],
      isLoading: false,
      refetch: mockRefetch,
    });
    (useSwipe as jest.Mock).mockReturnValue({ mutate: mockSwipeMutate });
  });

  it('renders tavern screen with profiles', () => {
    const { getByTestId, getByText } = render(<TavernScreen />);
    expect(getByTestId('tavern-screen')).toBeTruthy();
    expect(getByText('Hero 1')).toBeTruthy();
  });

  it('handles swipe left button press', () => {
    const { getByTestId } = render(<TavernScreen />);
    const leftBtn = getByTestId('swipe-left-button');
    
    fireEvent.press(leftBtn);
    
    expect(mockSwipeMutate).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'left',
      swipedProfileId: 'p1',
    }));
  });

  it('handles swipe right button press', () => {
    const { getByTestId } = render(<TavernScreen />);
    const rightBtn = getByTestId('swipe-right-button');
    
    fireEvent.press(rightBtn);
    
    expect(mockSwipeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'right',
        swipedProfileId: 'p1',
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it('shows empty state when no profiles are found', () => {
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
      refetch: mockRefetch,
    });
    
    const { getByText } = render(<TavernScreen />);
    expect(getByText('No Heroes Found')).toBeTruthy();
  });

  it('requires an active profile to swipe', () => {
    (useProfileContext as jest.Mock).mockReturnValue({ 
      activeProfileId: null, 
      isLoadingActiveProfile: false,
      refetchActiveProfile: jest.fn(),
      refetchProfiles: jest.fn(),
      profiles: [],
    });
    
    const { getByTestId } = render(<TavernScreen />);
    expect(getByTestId('tavern-screen-no-profile')).toBeTruthy();
  });
});
