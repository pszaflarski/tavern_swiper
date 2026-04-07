import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ProfilesScreen from '../app/(tabs)/profiles';
import { useProfiles } from '../hooks/useProfiles';
import { useUser } from '../hooks/useUser';
import { useProfileContext } from '../context/ProfileContext';

// Mock hooks
jest.mock('../hooks/useProfiles', () => ({
  useProfiles: jest.fn(),
  useDeleteProfile: jest.fn(() => ({
    mutate: jest.fn(),
  })),
}));

jest.mock('../hooks/useUser', () => ({
  useUser: jest.fn(),
}));

jest.mock('../context/ProfileContext', () => ({
  useProfileContext: jest.fn(),
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
    (useUser as jest.Mock).mockReturnValue({ user: { uid: 'test-user' } });
    (useProfiles as jest.Mock).mockReturnValue({ data: mockProfiles, isLoading: false });
    (useProfileContext as jest.Mock).mockReturnValue({
      activeProfileId: '1',
      setActiveProfileId: jest.fn(),
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
    (useProfiles as jest.Mock).mockReturnValue({ data: [], isLoading: true });
    
    const { getByText } = render(<ProfilesScreen />);
    expect(getByText('Consulting the Archives...')).toBeTruthy();
  });
});
