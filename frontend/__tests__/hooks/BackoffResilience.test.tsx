import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import TavernScreen from '../../screens/DiscoveryScreen';
import { useDiscoveryFeed } from '../../hooks/useProfiles';
import { useSwipe } from '../../hooks/useSwipe';
import { useUser } from '../../hooks/useUser';
import { useProfileContext } from '../../context/ProfileContext';

// Mock everything
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

jest.mock('../../hooks/useProfiles', () => ({
  useDiscoveryFeed: jest.fn(),
  useProfiles: jest.fn(() => ({ data: [] })),
  useActiveProfile: jest.fn(() => ({ data: null, isLoading: false })),
  useActivateProfile: jest.fn(() => ({ mutate: jest.fn() })),
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

// Mock SwipeDeck to be lightweight
jest.mock('../../components/SwipeDeck', () => {
  const { View, Text } = require('react-native');
  return ({ profiles }: any) => (
    <View testID="mock-swipe-deck">
      {profiles.map((p: any) => (
        <Text key={p.profile_id} testID={`card-${p.profile_id}`}>
          {p.display_name}
        </Text>
      ))}
    </View>
  );
});

describe('Discovery Backoff Resilience', () => {
  const mockRefetch = jest.fn();
  const mockProfiles = [
    { profile_id: 'p1', display_name: 'Hero 1' },
    { profile_id: 'p2', display_name: 'Hero 2' },
    { profile_id: 'p3', display_name: 'Hero 3' },
    { profile_id: 'p4', display_name: 'Hero 4' },
    { profile_id: 'p5', display_name: 'Hero 5' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    (useUser as jest.Mock).mockReturnValue({ 
      isAuthenticated: true, 
      isLoading: false,
    });
    
    (useProfileContext as jest.Mock).mockReturnValue({ 
      activeProfileId: 'ap1', 
      isLoadingActiveProfile: false,
      profiles: mockProfiles,
      refetchActiveProfile: jest.fn(),
      refetchProfiles: jest.fn(),
    });
    
    (useSwipe as jest.Mock).mockReturnValue({ mutate: jest.fn() });
    
    // Initial fetch returns data
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: mockProfiles,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 1,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('triggers backoff after a stale fetch (no new profiles)', async () => {
    const { rerender, queryByText, getByTestId, getByText } = render(<TavernScreen />);
    
    // Initial cards present - use waitFor since it might take a render cycle for initial deck to populate
    await waitFor(() => expect(getByText('Hero 1')).toBeTruthy());
    
    // Clear initial focus refetch
    mockRefetch.mockClear();

    // Swipe until watermark (3 cards left)
    const rightBtn = getByTestId('swipe-right-button');
    fireEvent.press(rightBtn); // index 1
    fireEvent.press(rightBtn); // index 2
    
    await waitFor(() => expect(mockRefetch).toHaveBeenCalledTimes(1));
    mockRefetch.mockClear();
    
    // Simulate API resolving with the same data
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: mockProfiles,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 2,
    });

    await act(async () => {
        rerender(<TavernScreen />);
    });

    // Now it should be backing off.
    mockRefetch.mockClear();
    fireEvent.press(rightBtn); // index 3
    
    // Watermark check: deck.length(5) - currentIndex(3) = 2. 2 <= 3 is true.
    // BUT should NOT refetch because isBackingOff is true.
    expect(mockRefetch).not.toHaveBeenCalled();
    
    // Fast forward to end of backoff
    act(() => {
        jest.advanceTimersByTime(5001);
    });
    
    // Now backoff is over. Next interaction should trigger it.
    mockRefetch.mockClear();
    fireEvent.press(rightBtn); // index 4
    await waitFor(() => expect(mockRefetch).toHaveBeenCalledTimes(1));
  });

  it('exhausts the realm after 5 consecutive stale fetches', async () => {
    const { rerender, getByTestId, queryByText, getByText } = render(<TavernScreen />);
    
    await waitFor(() => expect(getByText('Hero 1')).toBeTruthy());
    const rightBtn = getByTestId('swipe-right-button');
    
    // 1st Stale Fetch
    fireEvent.press(rightBtn); // Trigger watermark
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: mockProfiles,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 2,
    });
    await act(async () => rerender(<TavernScreen />));
    act(() => { jest.advanceTimersByTime(5001); });
    
    // 2nd Stale Fetch
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: mockProfiles,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 3,
    });
    await act(async () => rerender(<TavernScreen />));
    act(() => { jest.advanceTimersByTime(5001); });
    
    // 3rd Stale Fetch
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: mockProfiles,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 4,
    });
    await act(async () => rerender(<TavernScreen />));
    act(() => { jest.advanceTimersByTime(30001); });

    // 4th Stale Fetch
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: mockProfiles,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 5,
    });
    await act(async () => rerender(<TavernScreen />));
    act(() => { jest.advanceTimersByTime(30001); });
    
    // 5th Stale Fetch (Exhaustion trigger)
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: mockProfiles,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 6,
    });
    await act(async () => rerender(<TavernScreen />));
    
    // At this point exhausted=true. 
    // Now swipe the remaining cards to see the empty state.
    // We already swiped 1. Total is 5. Swipe 4 more.
    fireEvent.press(rightBtn); 
    fireEvent.press(rightBtn);
    fireEvent.press(rightBtn);
    fireEvent.press(rightBtn);
    
    // Now currentIndex should be 5, deck.length 5.
    expect(getByText('No Heroes Found')).toBeTruthy();
  });

  it('auto-recovers from exhaustion after 5 minutes', async () => {
    const { rerender, getByTestId, getByText, queryByText } = render(<TavernScreen />);
    
    await waitFor(() => expect(getByText('Hero 1')).toBeTruthy());
    const rightBtn = getByTestId('swipe-right-button');
    
    // Drive through 5 stale fetches to reach exhaustion
    fireEvent.press(rightBtn); // Trigger watermark
    for (let i = 2; i <= 6; i++) {
      (useDiscoveryFeed as jest.Mock).mockReturnValue({
        data: mockProfiles,
        isFetching: false,
        refetch: mockRefetch,
        dataUpdatedAt: i,
      });
      await act(async () => rerender(<TavernScreen />));
      if (i < 6) {
        // Advance past backoff delay between stale fetches
        act(() => { jest.advanceTimersByTime(i <= 3 ? 5001 : 30001); });
      }
    }
    
    // Swipe remaining cards to see exhaustion state
    fireEvent.press(rightBtn);
    fireEvent.press(rightBtn);
    fireEvent.press(rightBtn);
    fireEvent.press(rightBtn);
    expect(getByText('No Heroes Found')).toBeTruthy();
    
    // Now simulate new profiles arriving and the 5-minute auto-recovery firing.
    // After 5 minutes, exhausted should reset to false.
    const freshProfiles = [
      { profile_id: 'p10', display_name: 'New Hero' },
    ];
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: freshProfiles,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 100,
    });

    // Advance past the 5-minute auto-recovery timer
    await act(async () => {
      jest.advanceTimersByTime(5 * 60 * 1000 + 1);
    });

    // Rerender to pick up the new state
    await act(async () => rerender(<TavernScreen />));

    // The exhaustion flag should have been cleared by the auto-recovery timer.
    // The component should now be able to show the new hero.
    await waitFor(() => expect(getByText('New Hero')).toBeTruthy());
  });

  it('uses 30s backoff delay for stale counts 3 and 4', async () => {
    const { rerender, getByTestId, getByText } = render(<TavernScreen />);
    
    await waitFor(() => expect(getByText('Hero 1')).toBeTruthy());
    const rightBtn = getByTestId('swipe-right-button');
    
    // 1st Stale Fetch (count=1, delay=5s)
    fireEvent.press(rightBtn);
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: mockProfiles,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 2,
    });
    await act(async () => rerender(<TavernScreen />));
    act(() => { jest.advanceTimersByTime(5001); });
    
    // 2nd Stale Fetch (count=2, delay=5s)
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: mockProfiles,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 3,
    });
    await act(async () => rerender(<TavernScreen />));
    act(() => { jest.advanceTimersByTime(5001); });
    
    // 3rd Stale Fetch (count=3, delay=30s)
    (useDiscoveryFeed as jest.Mock).mockReturnValue({
      data: mockProfiles,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 4,
    });
    await act(async () => rerender(<TavernScreen />));

    // Now isBackingOff=true with 30s delay.
    // Advancing only 10s should NOT clear backoff.
    mockRefetch.mockClear();
    act(() => { jest.advanceTimersByTime(10000); });
    await act(async () => rerender(<TavernScreen />));

    // Swipe to trigger a watermark check — should be suppressed by backoff
    fireEvent.press(rightBtn);
    expect(mockRefetch).not.toHaveBeenCalled();
    
    // Advance remaining 20s+ to clear the 30s backoff
    mockRefetch.mockClear();
    act(() => { jest.advanceTimersByTime(20001); });
    
    // After backoff clears, the watermark effect fires automatically since
    // isBackingOff flips to false and we're below the card threshold.
    await waitFor(() => expect(mockRefetch).toHaveBeenCalled());
  });
});
