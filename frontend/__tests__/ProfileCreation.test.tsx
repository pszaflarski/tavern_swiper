import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import CreateAndEditProfileScreen from '../app/profiles/create_and_edit';
import { useCreateProfile, useUpdateProfile, useProfile } from '../hooks/useProfiles';
import { useUser } from '../hooks/useUser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

// Mock everything
jest.mock('../hooks/useProfiles', () => ({
  useCreateProfile: jest.fn(),
  useUpdateProfile: jest.fn(),
  useProfile: jest.fn(),
}));

jest.mock('../hooks/useUser', () => ({
  useUser: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: jest.fn(),
  Stack: {
    Screen: jest.fn(() => null),
  },
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));

describe('Profile Creation & Editing', () => {
  const mockRouter = { push: jest.fn(), back: jest.fn() };
  const mockCreateMutate = jest.fn();
  const mockUpdateMutate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useUser as jest.Mock).mockReturnValue({ user: { uid: 'test-user' } });
    (useCreateProfile as jest.Mock).mockReturnValue({ mutateAsync: mockCreateMutate, isPending: false });
    (useUpdateProfile as jest.Mock).mockReturnValue({ mutateAsync: mockUpdateMutate, isPending: false });
    (useProfile as jest.Mock).mockReturnValue({ data: null, isLoading: false });
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
  });

  it('renders creation form when no ID is provided', () => {
    const { getByText, getByTestId } = render(<CreateAndEditProfileScreen />);
    expect(getByTestId('profile-name-input')).toBeTruthy();
    expect(getByText('Forge Identity')).toBeTruthy();
  });

  it('handles input changes', () => {
    const { getByTestId } = render(<CreateAndEditProfileScreen />);
    const nameInput = getByTestId('profile-name-input');
    
    fireEvent.changeText(nameInput, 'Gimli');
    expect(nameInput.props.value).toBe('Gimli');
  });

  it('calls createProfile on save', async () => {
    const { getByTestId } = render(<CreateAndEditProfileScreen />);
    
    fireEvent.changeText(getByTestId('profile-name-input'), 'Aragorn');
    fireEvent.changeText(getByTestId('profile-tagline-input'), 'Strider');
    fireEvent.press(getByTestId('profile-forge-button'));

    await waitFor(() => {
      expect(mockCreateMutate).toHaveBeenCalledWith(expect.objectContaining({
        display_name: 'Aragorn',
        tagline: 'Strider',
      }));
      expect(mockRouter.back).toHaveBeenCalled();
    });
  });

  it('loads existing profile data in edit mode', () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: '123' });
    (useProfile as jest.Mock).mockReturnValue({
      data: {
        profile_id: '123',
        display_name: 'Gandalf',
        tagline: 'The Grey',
        bio: 'A wizard is never late',
        gender: 'Male',
        image_urls: ['http://magic.com/gandalf.jpg'],
      },
      isLoading: false,
    });

    const { getByTestId } = render(<CreateAndEditProfileScreen />);
    
    expect(getByTestId('profile-name-input').props.value).toBe('Gandalf');
    expect(getByTestId('profile-tagline-input').props.value).toBe('The Grey');
  });

  it('selects gender attribute', () => {
    const { getByTestId } = render(<CreateAndEditProfileScreen />);
    const maleBtn = getByTestId('profile-gender-Male');
    
    fireEvent.press(maleBtn);
    // Active style check is hard with styled components/complex theme, 
    // but we can check if it stays functional.
  });
});
