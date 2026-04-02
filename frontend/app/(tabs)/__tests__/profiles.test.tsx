import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ProfilesScreen from '../profiles';
import { useUser } from '../../../hooks/useUser';
import { useProfiles, useCreateProfile, useUpdateProfile, useUploadProfileImage } from '../../../hooks/useProfiles';
import { useActiveProfile } from '../../../lib/ActiveProfileContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock dependencies
jest.mock('../../../hooks/useUser');
jest.mock('../../../hooks/useProfiles');
jest.mock('../../../lib/ActiveProfileContext');
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));

// Mock SwipeCard as it uses Reanimated/Gesture handlers which are hard to test in Jest
jest.mock('../../../components/SwipeDeck', () => {
  const React = require('react');
  const { Text, View, TouchableOpacity } = require('react-native');
  return {
    SwipeCard: ({ profile, onSwipeLeft }: any) => (
      <View testID="mock-swipe-card">
        <Text>Mock Swipe Card</Text>
        <Text testID="preview-name">{profile.display_name}</Text>
        <Text testID="preview-class">{profile.character_class}</Text>
        <Text testID="preview-tagline">{profile.tagline}</Text>
        <Text testID="preview-realm">{profile.realm}</Text>
        <TouchableOpacity onPress={onSwipeLeft} testID="mock-swipe-dismiss">
          <Text>Dismiss</Text>
        </TouchableOpacity>
      </View>
    ),
  };
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('ProfilesScreen Preview', () => {
  beforeEach(() => {
    (useUser as jest.Mock).mockReturnValue({ user: { uid: 'user123' } });
    (useProfiles as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
      refetch: jest.fn(),
    });
    (useCreateProfile as jest.Mock).mockReturnValue({ mutateAsync: jest.fn() });
    (useUpdateProfile as jest.Mock).mockReturnValue({ mutateAsync: jest.fn() });
    (useUploadProfileImage as jest.Mock).mockReturnValue({ mutateAsync: jest.fn() });
    (useActiveProfile as jest.Mock).mockReturnValue({
      activeProfileId: null,
      setActiveProfileId: jest.fn(),
    });
  });

  it('opens and closes the profile preview', async () => {
    const { getByTestId, queryByText, getByText } = render(<ProfilesScreen />, { wrapper });

    // 1. Start creating a new hero
    fireEvent.press(getByTestId('forge-new-identity-button'));

    // 2. Verify "Preview Hero" button exists
    const previewButton = getByTestId('identity-preview-button');
    expect(previewButton).toBeTruthy();

    // 3. Click "Preview Hero"
    fireEvent.press(previewButton);

    // 4. Verify preview modal is shown
    expect(getByText('Hero Discovery Preview')).toBeTruthy();

    // 5. Verify the preview card is shown
    expect(getByTestId('mock-swipe-card')).toBeTruthy();

    // 6. Dismiss preview
    fireEvent.press(getByText('✕'));

    // 7. Verify we are back in the forge
    await waitFor(() => {
      expect(queryByText('Hero Discovery Preview')).toBeNull();
    });
    expect(getByText('New Hero')).toBeTruthy();
  });

  it('verifies data binding in the preview modal', async () => {
    const { getByTestId } = render(<ProfilesScreen />, { wrapper });

    // 1. Start creating
    fireEvent.press(getByTestId('forge-new-identity-button'));

    // 2. Fill fields
    fireEvent.changeText(getByTestId('identity-name-input'), 'Sir Test');
    fireEvent.changeText(getByTestId('identity-class-input'), 'Paladin');
    fireEvent.changeText(getByTestId('identity-tagline-input'), 'Binding test.');
    fireEvent.changeText(getByTestId('identity-realm-input'), 'Test Realm');

    // 3. Open Preview
    fireEvent.press(getByTestId('identity-preview-button'));

    // 4. Check if SwipeCard received the correct props
    expect(getByTestId('preview-name').props.children).toBe('Sir Test');
    expect(getByTestId('preview-class').props.children).toBe('Paladin');
    expect(getByTestId('preview-tagline').props.children).toBe('Binding test.');
    expect(getByTestId('preview-realm').props.children).toBe('Test Realm');
  });
});
