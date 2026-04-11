import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import MessagesScreen from '../app/(tabs)/messages';
import { useProfileContext } from '../context/ProfileContext';
import { useProfiles } from '../hooks/useProfiles';
import { useUser } from '../hooks/useUser';
import { useInvolvedMatches } from '../hooks/useMessages';

// Mock hooks
jest.mock('../hooks/useProfiles', () => ({
  useProfiles: jest.fn(),
}));

jest.mock('../hooks/useUser', () => ({
  useUser: jest.fn(),
}));

jest.mock('../context/ProfileContext', () => ({
  useProfileContext: jest.fn(),
}));

jest.mock('../hooks/useMessages', () => ({
  useInvolvedMatches: jest.fn(),
}));

describe('Messages Screen', () => {
  const mockMyProfiles = [
    {
      profile_id: 'p1',
      display_name: 'Thorin',
      image_urls: ['http://example.com/thorin.jpg'],
    },
    {
      profile_id: 'p2',
      display_name: 'Legolas',
      image_urls: ['http://example.com/legolas.jpg'],
    },
  ];

  const mockNewMatches = [
    {
      id: 'm1',
      otherProfile: { display_name: 'Elora', image_urls: [] },
    },
  ];

  const mockInbox = [
    {
      id: 'c1',
      otherProfile: { display_name: 'Thorne', image_urls: [] },
      lastMessage: { content: 'Hello there!', sent_at: new Date().toISOString() },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useUser as jest.Mock).mockReturnValue({ 
      user: { uid: 'test-user' }, 
      uid: 'test-user', 
      isAuthenticated: true, 
      isLoading: false,
      logout: jest.fn(),
    });
    (useProfiles as jest.Mock).mockReturnValue({ data: mockMyProfiles, isLoading: false });
    (useProfileContext as jest.Mock).mockReturnValue({
      activeProfileId: 'p1',
      setActiveProfileId: jest.fn(),
    });
    (useInvolvedMatches as jest.Mock).mockReturnValue({
      newMatches: mockNewMatches,
      inbox: mockInbox,
      isLoading: false,
    });
  });

  it('renders messages screen components correctly', () => {
    const { getByText, getByTestId } = render(<MessagesScreen />);

    expect(getByText('Messages')).toBeTruthy();
    expect(getByText('Thorin')).toBeTruthy();
    expect(getByText('Legolas')).toBeTruthy();

    // Check New Matches section
    expect(getByText('Elora')).toBeTruthy();
    expect(getByTestId('new-match-m1')).toBeTruthy();

    // Check Inbox section
    expect(getByText('Thorne')).toBeTruthy();
    expect(getByText('Hello there!')).toBeTruthy();
    expect(getByTestId('inbox-item-c1')).toBeTruthy();
  });

  it('switches active profile when a profile tab is pressed', () => {
    const { setActiveProfileId } = useProfileContext();
    const { getByTestId } = render(<MessagesScreen />);

    const legolasTab = getByTestId('profile-tab-p2');
    fireEvent.press(legolasTab);

    expect(setActiveProfileId).toHaveBeenCalledWith('p2');
  });

  it('handles pressing a new match', () => {
    const { getByTestId } = render(<MessagesScreen />);
    const newMatch = getByTestId('new-match-m1');
    
    // Clicking should fire the interaction, even if it doesn't navigate yet
    fireEvent.press(newMatch);
    
    // For now we just verify it exists and is pressable without error
    expect(newMatch).toBeTruthy();
  });

  it('handles pressing an inbox item', () => {
    const { getByTestId } = render(<MessagesScreen />);
    const inboxItem = getByTestId('inbox-item-c1');
    
    fireEvent.press(inboxItem);
    
    expect(inboxItem).toBeTruthy();
  });

  it('shows loading state when content is loading', () => {
    (useInvolvedMatches as jest.Mock).mockReturnValue({
      newMatches: [],
      inbox: [],
      isLoading: true,
    });

    const { getByText } = render(<MessagesScreen />);
    expect(getByText('Consulting the Oracle...')).toBeTruthy();
  });

  it('shows empty state when no matches or conversations exist', () => {
    (useInvolvedMatches as jest.Mock).mockReturnValue({
      newMatches: [],
      inbox: [],
      isLoading: false,
    });

    const { getByText } = render(<MessagesScreen />);
    expect(getByText('The stars reflect no new paths today.')).toBeTruthy();
    expect(getByText('Silence reigns in the tavern.')).toBeTruthy();
  });

  it('does not crash when data is malformed (not an array)', () => {
    (useProfiles as jest.Mock).mockReturnValue({ data: null, isLoading: false });
    (useInvolvedMatches as jest.Mock).mockReturnValue({
      newMatches: null as any,
      inbox: null as any,
      isLoading: false,
    });

    const { getByText } = render(<MessagesScreen />);
    
    // Should render without crashing, even if it shows empty/error state
    expect(getByText('Messages')).toBeTruthy();
  });
});
