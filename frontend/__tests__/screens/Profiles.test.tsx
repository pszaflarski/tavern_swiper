import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ProfilesScreen from '../../screens/ProfileListScreen';
import { useProfiles } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useProfileContext } from '../../context/ProfileContext';

// Mock hooks
jest.mock('../../hooks/useProfiles', () => ({
  useProfiles: jest.fn(),
  useDeleteProfile: jest.fn(() => ({
    mutate: jest.fn(),
  })),
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

describe('Profiles Screen', () => {
  const mockProfiles = [
    {
      profile_id: '1',
      display_name: 'Thorin Oakenshield',
      bio: 'King under the mountain',
      image_urls: ['http://example.com/thorin.jpg'],
    },
    {
      profile_id: '2',
      display_name: 'Legolas Greenleaf',
      bio: 'Elf of Mirkwood',
      image_urls: ['http://example.com/legolas.jpg'],
    },
  ];

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
    (useProfiles as jest.Mock).mockReturnValue({ 
      data: mockProfiles, 
      isLoading: false, 
      isPending: false,
      refetch: jest.fn(),
    });
    (useProfileContext as jest.Mock).mockReturnValue({
      activeProfileId: '1',
      setActiveProfileId: jest.fn(),
      refetchActiveProfile: jest.fn(),
      refetchProfiles: jest.fn(),
      profiles: mockProfiles,
    });
  });

  it('renders profiles list', () => {
    const { getByText, getByTestId } = render(<ProfilesScreen />);
    
    expect(getByText('Thorin Oakenshield')).toBeTruthy();
    expect(getByText('Legolas Greenleaf')).toBeTruthy();
    expect(getByTestId('profile-name-Thorin Oakenshield')).toBeTruthy();
  });

  it('shows hamburger menu buttons for each profile', () => {
    const { getByTestId } = render(<ProfilesScreen />);
    
    expect(getByTestId('profile-menu-1')).toBeTruthy();
    expect(getByTestId('profile-menu-2')).toBeTruthy();
  });

  it('expands card into action buttons when hamburger is pressed', () => {
    const { getByTestId, queryByTestId } = render(<ProfilesScreen />);
    
    // Action buttons should not exist before expanding
    expect(queryByTestId('preview-profile-button-1')).toBeNull();
    
    // Tap hamburger
    fireEvent.press(getByTestId('profile-menu-1'));
    
    // Action buttons should now be visible
    expect(getByTestId('preview-profile-button-1')).toBeTruthy();
    expect(getByTestId('edit-profile-button-1')).toBeTruthy();
    expect(getByTestId('delete-profile-button-1')).toBeTruthy();
    expect(getByTestId('cancel-menu-button-1')).toBeTruthy();
  });

  it('collapses back to normal card when cancel is pressed', () => {
    const { getByTestId, queryByTestId } = render(<ProfilesScreen />);
    
    // Expand
    fireEvent.press(getByTestId('profile-menu-1'));
    expect(getByTestId('cancel-menu-button-1')).toBeTruthy();
    
    // Cancel
    fireEvent.press(getByTestId('cancel-menu-button-1'));
    
    // Should be back to normal — hamburger visible, actions gone
    expect(getByTestId('profile-menu-1')).toBeTruthy();
    expect(queryByTestId('preview-profile-button-1')).toBeNull();
  });

  it('shows "Set Active" button only for non-active profiles in the expanded menu', () => {
    const { getByTestId, queryByTestId } = render(<ProfilesScreen />);
    
    // Profile 1 is active — expand it
    fireEvent.press(getByTestId('profile-menu-1'));
    expect(queryByTestId('select-profile-button-1')).toBeNull();
  });

  it('calls setActiveProfileId when a non-active profile card is tapped', () => {
    const mockSetActive = jest.fn();
    (useProfileContext as jest.Mock).mockReturnValue({
      activeProfileId: '1',
      setActiveProfileId: mockSetActive,
      refetchActiveProfile: jest.fn(),
      refetchProfiles: jest.fn(),
      profiles: [],
    });

    const { getByTestId } = render(<ProfilesScreen />);
    
    // Profile 2 is NOT active — tapping its card should activate it
    fireEvent.press(getByTestId('profile-card-tap-2'));
    expect(mockSetActive).toHaveBeenCalledWith('2');
  });

  it('does NOT call setActiveProfileId when the already-active profile card is tapped', () => {
    const mockSetActive = jest.fn();
    (useProfileContext as jest.Mock).mockReturnValue({
      activeProfileId: '1',
      setActiveProfileId: mockSetActive,
      refetchActiveProfile: jest.fn(),
      refetchProfiles: jest.fn(),
      profiles: [],
    });

    const { getByTestId } = render(<ProfilesScreen />);
    
    // Profile 1 IS active — tapping its card should do nothing
    fireEvent.press(getByTestId('profile-card-tap-1'));
    expect(mockSetActive).not.toHaveBeenCalled();
  });

  it('shows loading state', () => {
    (useProfiles as jest.Mock).mockReturnValue({ 
      data: undefined, 
      isLoading: true, 
      isPending: true,
      refetch: jest.fn(),
    });
    
    const { getByText } = render(<ProfilesScreen />);
    expect(getByText('Awakening the Archive...')).toBeTruthy();
  });

  it('renders forge identity button at the bottom', () => {
    const { getByTestId } = render(<ProfilesScreen />);
    
    expect(getByTestId('add-profile-button')).toBeTruthy();
  });

  it('shows forge your first hero when list is empty', () => {
    (useProfiles as jest.Mock).mockReturnValue({ 
      data: [], 
      isLoading: false, 
      isPending: false,
      refetch: jest.fn(),
    });

    const { getByTestId, getByText } = render(<ProfilesScreen />);

    expect(getByTestId('empty-state-add-profile-button')).toBeTruthy();
    expect(getByText('Forge Your First Identity')).toBeTruthy();
  });

  it('grays out and disables edit option for a generated profile', () => {
    const mockProfilesWithGen = [
      {
        profile_id: '1',
        display_name: 'Thorin Oakenshield',
        bio: 'King under the mountain',
        image_urls: ['http://example.com/thorin.jpg'],
        generated: true,
      },
    ];
    (useProfiles as jest.Mock).mockReturnValue({ 
      data: mockProfilesWithGen, 
      isLoading: false, 
      isPending: false,
      refetch: jest.fn(),
    });
    (useProfileContext as jest.Mock).mockReturnValue({
      activeProfileId: '1',
      setActiveProfileId: jest.fn(),
      refetchActiveProfile: jest.fn(),
      refetchProfiles: jest.fn(),
      profiles: mockProfilesWithGen,
    });

    const { getByTestId } = render(<ProfilesScreen />);
    
    // Expand Profile menu
    fireEvent.press(getByTestId('profile-menu-1'));
    
    const editBtn = getByTestId('edit-profile-button-1');
    expect(editBtn.props.accessibilityState?.disabled).toBe(true);
  });
});
