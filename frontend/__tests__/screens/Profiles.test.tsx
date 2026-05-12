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

  it('switches active profile on press', () => {
    const { setActiveProfileId } = useProfileContext();
    const { getByTestId } = render(<ProfilesScreen />);
    
    const secondProfile = getByTestId('profile-item-2');
    fireEvent.press(secondProfile);
    
    expect(setActiveProfileId).toHaveBeenCalledWith('2');
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
});
