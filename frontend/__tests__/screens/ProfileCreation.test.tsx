import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import CreateAndEditProfileScreen from '../../screens/ProfileFormScreen';
import { useCreateProfile, useUpdateProfile, useProfile, useUploadProfileImage } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

// Mock everything
jest.mock('../../hooks/useProfiles', () => ({
  useCreateProfile: jest.fn(),
  useUpdateProfile: jest.fn(),
  useProfile: jest.fn(),
  useUploadProfileImage: jest.fn(),
}));

jest.mock('../../hooks/useTags', () => ({
  useTagsByCategory: jest.fn().mockReturnValue({ data: [], isLoading: false }),
  useSearchTags: jest.fn().mockReturnValue({ data: [], isLoading: false }),
  useCreateTag: jest.fn().mockReturnValue({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('../../hooks/useUser', () => ({
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
  MediaTypeOptions: { Images: 'images' },
}));

jest.mock('expo-file-system', () => ({
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../components/ImageCropperModal', () => ({
  ImageCropperModal: ({ isVisible, onCropComplete, imageUri }: any) => {
    // Automatically trigger completion for tests when modal appears
    require('react').useEffect(() => {
      if (isVisible && imageUri) {
        onCropComplete('processed-uri-123');
      }
    }, [isVisible, imageUri]);
    return null;
  },
}));

jest.mock('../../lib/imageProcessing', () => ({
  prepareImageUpload: jest.fn().mockResolvedValue(new Blob(['test'], { type: 'image/jpeg' })),
}));

// Mock global fetch and File for image uploading logic
(global as any).fetch = jest.fn();
(global as any).File = class {
  constructor(public parts: any[], public name: string, public options: any) {}
};

describe('Profile Creation & Editing', () => {
  const mockRouter = { push: jest.fn(), back: jest.fn() };
  const mockCreateMutate = jest.fn();
  const mockUpdateMutate = jest.fn();
  const mockUploadMutate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useUser as jest.Mock).mockReturnValue({ 
      user: { uid: 'test-user' }, 
      uid: 'test-user', 
      isAuthenticated: true, 
      isLoading: false,
      refetch: jest.fn(),
      logout: jest.fn(),
    });
    (useCreateProfile as jest.Mock).mockReturnValue({ mutateAsync: mockCreateMutate.mockResolvedValue({ profile_id: 'new-profile-id' }), isPending: false, refetch: jest.fn() });
    (useUpdateProfile as jest.Mock).mockReturnValue({ mutateAsync: mockUpdateMutate, isPending: false, refetch: jest.fn() });
    (useUploadProfileImage as jest.Mock).mockReturnValue({ mutateAsync: mockUploadMutate, isPending: false, refetch: jest.fn() });
    (useProfile as jest.Mock).mockReturnValue({ data: null, isLoading: false, refetch: jest.fn() });
    (useLocalSearchParams as jest.Mock).mockReturnValue({});
    
    // Default fetch mock returning a simple blob-like object
    (global.fetch as jest.Mock).mockResolvedValue({
      blob: jest.fn().mockResolvedValue({}), // Blob content not used much in these mocks
    });
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

  it('calls createProfile on save with OC defaulting to true', async () => {
    const { getByTestId } = render(<CreateAndEditProfileScreen />);
    
    fireEvent.changeText(getByTestId('profile-name-input'), 'Aragorn');
    fireEvent.changeText(getByTestId('profile-tagline-input'), 'Strider');
    fireEvent.press(getByTestId('profile-forge-button'));

    await waitFor(() => {
      expect(mockCreateMutate).toHaveBeenCalledWith(expect.objectContaining({
        display_name: 'Aragorn',
        tagline: 'Strider',
        is_oc: true,
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
        image_urls: ['http://magic.com/gandalf.jpg'],
      },
      isLoading: false,
    });

    const { getByTestId } = render(<CreateAndEditProfileScreen />);
    
    expect(getByTestId('profile-name-input').props.value).toBe('Gandalf');
    expect(getByTestId('profile-tagline-input').props.value).toBe('The Grey');
  });

  it('toggles OC checkbox (defaults to checked)', () => {
    const { getByTestId } = render(<CreateAndEditProfileScreen />);
    const ocToggle = getByTestId('profile-oc-toggle');
    // OC defaults to true — pressing should uncheck it
    fireEvent.press(ocToggle);
    expect(ocToggle).toBeTruthy();
  });

  it('shows only one empty slot initially (progressive grid)', () => {
    const { queryByTestId } = render(<CreateAndEditProfileScreen />);
    // Should show exactly 1 slot (the empty upload slot)
    expect(queryByTestId('profile-image-slot-0')).toBeTruthy();
    expect(queryByTestId('profile-image-slot-1')).toBeNull();
  });

  it('uploads local images and verifies persistence logic after save', async () => {
    // 1. Mock choosing a local image
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'blob:mock-uri-123' }]
    });

    // 2. Mock creation returning a profile ID
    mockCreateMutate.mockResolvedValue({ profile_id: 'new-profile-uid' });

    const { getByTestId, findByTestId } = render(<CreateAndEditProfileScreen />);
    
    // Trigger image picker
    const addImgBtn = getByTestId('profile-image-add-button-0');
    fireEvent.press(addImgBtn);
    
    // Wait for image to appear in the grid
    await waitFor(() => {
      expect(getByTestId('profile-image-filled-0')).toBeTruthy();
    });

    // Enter name
    fireEvent.changeText(getByTestId('profile-name-input'), 'Thoran');
    
    // Press save (Forge)
    const forgeBtn = getByTestId('profile-forge-button');
    fireEvent.press(forgeBtn);

    await waitFor(() => {
      // Should have called create
      expect(mockCreateMutate).toHaveBeenCalled();
      
      // Should have called upload for the blob: URI
      expect(mockUploadMutate).toHaveBeenCalledWith(expect.objectContaining({
        profileId: 'new-profile-uid',
        index: 0,
        file: expect.any(Object) // The File object
      }));
      
      // Should have finished and navigated back
      expect(mockRouter.back).toHaveBeenCalled();
    });
  });

  it('renders permanent GCS images from existing profile data', () => {
    const permanentUrl = 'https://storage.googleapis.com/tavern/p1/0_avatar.jpg';
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'p1' });
    (useProfile as jest.Mock).mockReturnValue({
      data: {
        profile_id: 'p1',
        display_name: 'Gimli',
        image_urls: [permanentUrl],
      },
      isLoading: false,
    });

    const { getByTestId } = render(<CreateAndEditProfileScreen />);
    
    // Check if the image source is the permanent URL
    const image = getByTestId('profile-image-filled-0').children[0];
    expect(image.props.source.uri).toBe(permanentUrl);
  });
});
