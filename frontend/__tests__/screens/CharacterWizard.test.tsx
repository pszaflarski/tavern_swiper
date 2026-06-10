import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import CharacterWizardScreen from '../../screens/CharacterWizardScreen';
import { charactersApi, profilesApi } from '../../lib/api';
import Toast from 'react-native-toast-message';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

// Mock the API client
jest.mock('../../lib/api', () => ({
  charactersApi: {
    get: jest.fn(),
  },
  profilesApi: {
    post: jest.fn(),
  },
}));

// Mock react-native-toast-message
jest.mock('react-native-toast-message', () => ({
  show: jest.fn(),
  hide: jest.fn(),
}));

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
};

// Mock expo-router
jest.mock('expo-router', () => ({
  router: mockRouter,
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/',
  useFocusEffect: jest.fn((cb) => cb()),
}));

const mockCharacters = [
  {
    character_id: 'char-1',
    display_name: 'Aethelgard Moonwhisper',
    tagline: 'The forest speaks to those who listen.',
    bio: 'A wandering elven druid who has lived for over three centuries.',
    fandom: [{ id: 'f1', category: 'fandom', name: 'D&D', slug: 'dnd' }],
    race: [{ id: 'r1', category: 'race', name: 'Elf', slug: 'elf' }],
    gender: [{ id: 'g1', category: 'gender', name: 'Male', slug: 'male' }],
    images: [{ image_id: 'img-1', url: 'http://example.com/aethelgard.jpg', source_type: 'gcs', position: 0 }],
  },
  {
    character_id: 'char-2',
    display_name: 'Lilith Starspire',
    tagline: 'Forbidden shadow magic.',
    bio: 'An elven shadow wizard.',
    fandom: [{ id: 'f1', category: 'fandom', name: 'D&D', slug: 'dnd' }],
    race: [{ id: 'r1', category: 'race', name: 'Elf', slug: 'elf' }],
    gender: [{ id: 'g2', category: 'gender', name: 'Female', slug: 'female' }],
    images: [{ image_id: 'img-2', url: 'http://example.com/lilith.jpg', source_type: 'gcs', position: 0 }],
  }
];

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('Character Wizard Screen', () => {
  const mockRefetchQueries = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (charactersApi.get as jest.Mock).mockResolvedValue({ data: mockCharacters });
    (profilesApi.post as jest.Mock).mockResolvedValue({ data: { profile_id: 'new-profile-id' } });

    // Mock query client to include refetchQueries
    (useQueryClient as jest.Mock).mockReturnValue({
      invalidateQueries: jest.fn(),
      refetchQueries: mockRefetchQueries,
      setQueryData: jest.fn(),
      getQueryData: jest.fn(),
    });
  });

  it('renders step 1 (Fandom selection) and requires a selection to proceed', () => {
    const { getByText, getByTestId } = render(<CharacterWizardScreen />, { wrapper: createWrapper() });

    expect(getByText(/Select Fandom Universe/i)).toBeTruthy();
    expect(getByText('Dungeons & Dragons')).toBeTruthy();

    // Next button should be disabled initially (since fandom is empty and required)
    const nextButton = getByTestId('wizard-next-button');
    expect(nextButton.props.accessibilityState?.disabled).toBe(true);

    // Select Dungeons & Dragons
    fireEvent.press(getByText('Dungeons & Dragons'));

    // Next button should now be enabled
    expect(nextButton.props.accessibilityState?.disabled).toBe(false);
  });

  it('allows navigating back and forth through the steps', () => {
    const { getByText, getByTestId } = render(<CharacterWizardScreen />, { wrapper: createWrapper() });

    // Step 1: Select Fandom
    fireEvent.press(getByText('Dungeons & Dragons'));
    fireEvent.press(getByTestId('wizard-next-button'));

    // Step 2: Choose Gender Identity
    expect(getByText(/Choose Gender Identity/i)).toBeTruthy();
    expect(getByText('Male')).toBeTruthy();
    
    // Select Male and click Next
    fireEvent.press(getByText('Male'));
    fireEvent.press(getByTestId('wizard-next-button'));

    // Step 3: Select Fantasy Race
    expect(getByText(/Select Fantasy Race/i)).toBeTruthy();
    expect(getByText('Elf')).toBeTruthy();
    
    // Go Back to Step 2
    fireEvent.press(getByTestId('wizard-back-button'));
    expect(getByText(/Choose Gender Identity/i)).toBeTruthy();

    // Go Next back to Step 3
    fireEvent.press(getByTestId('wizard-next-button'));
    expect(getByText(/Select Fantasy Race/i)).toBeTruthy();
  });

  it('completes selection and shows a matching character at Step 5', async () => {
    const { getByText, getByTestId } = render(<CharacterWizardScreen />, { wrapper: createWrapper() });

    // Step 1
    fireEvent.press(getByText('Dungeons & Dragons'));
    fireEvent.press(getByTestId('wizard-next-button'));

    // Step 2
    fireEvent.press(getByText('Male'));
    fireEvent.press(getByTestId('wizard-next-button'));

    // Step 3
    fireEvent.press(getByText('Elf'));
    fireEvent.press(getByTestId('wizard-next-button'));

    // Step 4
    fireEvent.press(getByText('Fighter'));
    fireEvent.press(getByTestId('wizard-next-button'));

    // Step 5 loading / result
    await waitFor(() => {
      expect(charactersApi.get).toHaveBeenCalledWith('/characters/');
    });

    // Check that we see the first match (Aethelgard Moonwhisper has D&D, Elf, Male matching selections)
    await waitFor(() => {
      expect(getByText('Aethelgard Moonwhisper')).toBeTruthy();
      expect(getByText('"The forest speaks to those who listen."')).toBeTruthy();
    });

    // Check that the buttons "Adopt This Hero" and "Back to Start" are visible
    expect(getByText('Adopt This Hero')).toBeTruthy();
    expect(getByText('Back to Start')).toBeTruthy();
  });

  it('cycles through matches when clicking Next Match if multiple exist', async () => {
    const { getByText, getByTestId } = render(<CharacterWizardScreen />, { wrapper: createWrapper() });

    // Go through steps choosing D&D + Elf (both mock characters are D&D + Elf)
    fireEvent.press(getByText('Dungeons & Dragons'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByTestId('wizard-next-button')); // Skip Gender
    fireEvent.press(getByText('Elf'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByTestId('wizard-next-button')); // Skip Class

    // Wait for character fetch
    await waitFor(() => {
      expect(getByText('Aethelgard Moonwhisper')).toBeTruthy();
    });

    // Next Match button should be visible since both match Elf
    const nextMatchBtn = getByText('Next Match');
    expect(nextMatchBtn).toBeTruthy();

    // Tap Next Match
    fireEvent.press(nextMatchBtn);

    // Should now show the second character
    await waitFor(() => {
      expect(getByText('Lilith Starspire')).toBeTruthy();
    });
  });

  it('shows empty state when no character matches the criteria', async () => {
    // Return empty characters array
    (charactersApi.get as jest.Mock).mockResolvedValue({ data: [] });

    const { getByText, getByTestId } = render(<CharacterWizardScreen />, { wrapper: createWrapper() });

    fireEvent.press(getByText('Dungeons & Dragons'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByTestId('wizard-next-button'));

    await waitFor(() => {
      expect(getByText('Tavern Empty')).toBeTruthy();
      expect(getByText('Reset Wizard')).toBeTruthy();
    });

    // Click Reset Wizard to return to Step 1
    fireEvent.press(getByText('Reset Wizard'));
    expect(getByText(/Select Fandom Universe/i)).toBeTruthy();
  });

  it('successfully adopts a hero and redirects to profile list', async () => {
    const { getByText, getByTestId } = render(<CharacterWizardScreen />, { wrapper: createWrapper() });

    // Navigate to step 5
    fireEvent.press(getByText('Dungeons & Dragons'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByText('Male'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByText('Elf'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByTestId('wizard-next-button'));

    await waitFor(() => {
      expect(getByText('Aethelgard Moonwhisper')).toBeTruthy();
    });

    // Click "Adopt This Hero"
    fireEvent.press(getByText('Adopt This Hero'));

    await waitFor(() => {
      // Verifies profilesApi.post was called with correct structure
      expect(profilesApi.post).toHaveBeenCalledWith('/profiles/', expect.objectContaining({
        display_name: 'Aethelgard Moonwhisper',
        tagline: 'The forest speaks to those who listen.',
        bio: 'A wandering elven druid who has lived for over three centuries.',
        is_oc: false,
        generated: true,
        image_urls: ['http://example.com/aethelgard.jpg'],
        fandom: [{ id: 'f1', category: 'fandom', name: 'D&D', slug: 'dnd' }],
        race: [{ id: 'r1', category: 'race', name: 'Elf', slug: 'elf' }],
        gender: [{ id: 'g1', category: 'gender', name: 'Male', slug: 'male' }],
      }));

      // Verifies toast notification and router redirect
      expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({
        type: 'success',
        text1: '⚔️ Hero Adopted!',
      }));
      expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/profiles');
    });
  });

  it('shows toast error message if adoption fails', async () => {
    (profilesApi.post as jest.Mock).mockRejectedValue(new Error('Network error'));

    const { getByText, getByTestId } = render(<CharacterWizardScreen />, { wrapper: createWrapper() });

    // Navigate to step 5
    fireEvent.press(getByText('Dungeons & Dragons'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByText('Male'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByText('Elf'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByTestId('wizard-next-button'));

    await waitFor(() => {
      expect(getByText('Aethelgard Moonwhisper')).toBeTruthy();
    });

    // Click "Adopt This Hero"
    fireEvent.press(getByText('Adopt This Hero'));

    await waitFor(() => {
      expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        text1: 'Summoning Failed',
      }));
    });
  });
});
