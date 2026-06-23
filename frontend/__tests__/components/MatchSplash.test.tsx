import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import MatchSplash from '../../components/MatchSplash';
import { useMatch } from '../../context/MatchContext';
import { useProfileContext } from '../../context/ProfileContext';

// Mock the context hooks
jest.mock('../../context/MatchContext', () => ({
  useMatch: jest.fn(),
}));

jest.mock('../../context/ProfileContext', () => ({
  useProfileContext: jest.fn(),
}));

const mockCreateConversation = jest.fn().mockResolvedValue({ conversation_id: 'conv-123' });
jest.mock('../../hooks/useMessages', () => ({
  useCreateConversation: jest.fn(() => ({
    mutateAsync: mockCreateConversation,
  })),
}));

describe('MatchSplash Component', () => {
  const mockHideMatch = jest.fn();
  const mockClearMatchedProfile = jest.fn();

  const matchedProfile = {
    profile_id: 'mp1',
    display_name: 'Elara Moonshadow',
    image_url: 'https://example.com/elara.jpg',
  };

  const activeProfile = {
    profile_id: 'ap1',
    display_name: 'Thorin Stoneheart',
    image_urls: ['https://example.com/thorin.jpg'],
    is_active: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useProfileContext as jest.Mock).mockReturnValue({
      activeProfileId: 'ap1',
      profiles: [activeProfile],
    });
  });

  function mockMatchState(overrides: Partial<ReturnType<typeof useMatch>> = {}) {
    (useMatch as jest.Mock).mockReturnValue({
      isMatchVisible: true,
      hideMatch: mockHideMatch,
      clearMatchedProfile: mockClearMatchedProfile,
      matchedProfile,
      ...overrides,
    });
  }

  // --- Rendering ---

  it('renders nothing when matchedProfile is null', () => {
    mockMatchState({ matchedProfile: null });
    const { toJSON } = render(<MatchSplash />);
    expect(toJSON()).toBeNull();
  });

  it('renders the overlay when matchedProfile is set and isMatchVisible is true', () => {
    mockMatchState();
    const { getByText } = render(<MatchSplash />);

    expect(getByText('Fate Decided!')).toBeTruthy();
    expect(getByText('A Mutual Bond Has Been Forged')).toBeTruthy();
  });

  it('displays the matched profile display name', () => {
    mockMatchState();
    const { getByText } = render(<MatchSplash />);
    expect(getByText('Elara Moonshadow')).toBeTruthy();
  });

  it('displays the active profile display name', () => {
    mockMatchState();
    const { getByText } = render(<MatchSplash />);
    expect(getByText('Thorin Stoneheart')).toBeTruthy();
  });

  it('falls back to "You" when there is no active profile', () => {
    (useProfileContext as jest.Mock).mockReturnValue({
      activeProfileId: undefined,
      profiles: [],
    });
    mockMatchState();
    const { getByText } = render(<MatchSplash />);
    expect(getByText('You')).toBeTruthy();
  });

  // --- Placeholder images ---

  it('shows shield emoji placeholder when active profile has no images', () => {
    (useProfileContext as jest.Mock).mockReturnValue({
      activeProfileId: 'ap1',
      profiles: [{ ...activeProfile, image_urls: [] }],
    });
    mockMatchState();
    const { getByText } = render(<MatchSplash />);
    expect(getByText('🛡️')).toBeTruthy();
  });

  it('shows sword emoji placeholder when matched profile has no image', () => {
    mockMatchState({ matchedProfile: { ...matchedProfile, image_url: '' } });
    const { getByText } = render(<MatchSplash />);
    expect(getByText('⚔️')).toBeTruthy();
  });

  // --- Button interactions ---

  it('dismisses splash and navigates to new conversation route on "INITIATE CONVERSATION"', () => {
    const { router } = require('expo-router');
    mockMatchState();
    const { getByText } = render(<MatchSplash />);

    fireEvent.press(getByText('INITIATE CONVERSATION'));
    
    // Splash dismissed and navigated to the deferred conversation route
    expect(mockHideMatch).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/messages/new_mp1');

    // Conversation is NOT created yet — that happens on first message send
    expect(mockCreateConversation).not.toHaveBeenCalled();
  });

  it('calls hideMatch when "Return to the Tavern" is pressed', () => {
    mockMatchState();
    const { getByText } = render(<MatchSplash />);

    fireEvent.press(getByText('Return to the Tavern'));
    expect(mockHideMatch).toHaveBeenCalledTimes(1);
  });

  // --- Visibility transitions ---

  it('still renders content when isMatchVisible is false but matchedProfile exists (exit animation)', () => {
    // This state occurs during the exit animation: visibility is false,
    // but clearMatchedProfile hasn't been called yet by runOnJS
    mockMatchState({ isMatchVisible: false });
    const { getByText } = render(<MatchSplash />);

    // Component should still be in the tree (for exit animation)
    expect(getByText('Fate Decided!')).toBeTruthy();
    expect(getByText('Elara Moonshadow')).toBeTruthy();
  });

  it('sets pointerEvents to none when isMatchVisible is false', () => {
    mockMatchState({ isMatchVisible: false });
    const { toJSON } = render(<MatchSplash />);
    
    // The root Animated.View should have pointerEvents='none'
    const tree = toJSON();
    expect(tree).not.toBeNull();
    expect((tree as any).props.pointerEvents).toBe('none');
  });

  it('sets pointerEvents to auto when isMatchVisible is true', () => {
    mockMatchState({ isMatchVisible: true });
    const { toJSON } = render(<MatchSplash />);
    
    const tree = toJSON();
    expect(tree).not.toBeNull();
    expect((tree as any).props.pointerEvents).toBe('auto');
  });

  // --- Edge cases ---

  it('handles a match with a very long display name without crashing', () => {
    const longName = 'A'.repeat(200);
    mockMatchState({
      matchedProfile: { ...matchedProfile, display_name: longName },
    });
    const { getByText } = render(<MatchSplash />);
    expect(getByText(longName)).toBeTruthy();
  });

  it('renders both action buttons simultaneously', () => {
    mockMatchState();
    const { getByText } = render(<MatchSplash />);

    expect(getByText('INITIATE CONVERSATION')).toBeTruthy();
    expect(getByText('Return to the Tavern')).toBeTruthy();
  });
});
