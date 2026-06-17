import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import CharacterWizardScreen from '../../screens/CharacterWizardScreen';
import { charactersApi, profilesApi } from '../../lib/api';
import Toast from 'react-native-toast-message';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';

// Mock the API client
jest.mock('../../lib/api', () => ({
  charactersApi: {
    get: jest.fn(),
    post: jest.fn(),
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

const mockFandoms = [{ id: 'tag-dnd', category: 'fandom', name: 'D&D', slug: 'fandom__dnd' }];
const mockGenders = [{ id: 'tag-male', category: 'gender', name: 'Male', slug: 'gender__male' }];
const mockRaces = [{ id: 'tag-elf', category: 'race', name: 'Elf', slug: 'race__elf' }];
const mockClasses = [{ id: 'tag-fighter', category: 'class', name: 'Fighter', slug: 'class__fighter' }];

const mockGeneratedCharacter = {
  character_id: 'char-id-123',
  display_name: 'Aethelgard Moonwhisper',
  tagline: 'The forest speaks to those who listen.',
  bio: 'A wandering elven druid.',
  fandom: [{ id: 'tag-dnd', category: 'fandom', name: 'D&D', slug: 'fandom__dnd' }],
  race: [{ id: 'tag-elf', category: 'race', name: 'Elf', slug: 'race__elf' }],
  gender: [{ id: 'tag-male', category: 'gender', name: 'Male', slug: 'gender__male' }],
  class: [{ id: 'tag-fighter', category: 'class', name: 'Fighter', slug: 'class__fighter' }],
  images: [],
  status: 'pending',
};

const mockCharacterWithImage = {
  ...mockGeneratedCharacter,
  images: [{ image_id: 'img-123', url: 'http://example.com/portrait.jpg', source_type: 'ai_generated', position: 0 }],
};

const mockAdoptedCharacter = {
  ...mockCharacterWithImage,
  status: 'adopted',
};

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

    // Mock category tags fetching
    (charactersApi.get as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/by-category/fandom')) return Promise.resolve({ data: mockFandoms });
      if (url.includes('/by-category/gender')) return Promise.resolve({ data: mockGenders });
      if (url.includes('/by-category/race')) return Promise.resolve({ data: mockRaces });
      if (url.includes('/by-category/class')) return Promise.resolve({ data: mockClasses });
      return Promise.resolve({ data: [] });
    });

    // Mock generate, generate-image, and adopt endpoints
    (charactersApi.post as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/generate-image')) return Promise.resolve({ data: mockCharacterWithImage });
      if (url.includes('/adopt')) return Promise.resolve({ data: mockAdoptedCharacter });
      if (url.includes('/generate')) return Promise.resolve({ data: mockGeneratedCharacter });
      return Promise.resolve({ data: {} });
    });

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

  it('resolves tags, generates details, and fires background portrait generation at Step 5', async () => {
    const { getByText, getByTestId } = render(<CharacterWizardScreen />, { wrapper: createWrapper() });

    // Navigate to step 5
    fireEvent.press(getByText('Dungeons & Dragons'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByText('Male'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByText('Elf'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByText('Fighter'));
    fireEvent.press(getByTestId('wizard-next-button'));

    // Wait for tag resolution and details generation
    await waitFor(() => {
      expect(charactersApi.post).toHaveBeenCalledWith('/characters/generate', expect.objectContaining({
        fandom: [{ id: 'tag-dnd', category: 'fandom', name: 'D&D', slug: 'fandom__dnd' }],
        gender: [{ id: 'tag-male', category: 'gender', name: 'Male', slug: 'gender__male' }],
        race: [{ id: 'tag-elf', category: 'race', name: 'Elf', slug: 'race__elf' }],
        class: [{ id: 'tag-fighter', category: 'class', name: 'Fighter', slug: 'class__fighter' }],
      }));
    });

    // Check that we see the generated character details
    await waitFor(() => {
      expect(getByText('Aethelgard Moonwhisper')).toBeTruthy();
      expect(getByText('"The forest speaks to those who listen."')).toBeTruthy();
    });

    // Verify background image generation call
    await waitFor(() => {
      expect(charactersApi.post).toHaveBeenCalledWith('/characters/char-id-123/generate-image');
    });

    // Verify buttons "Adopt This Hero" and "Back to Start" are visible
    expect(getByText('Adopt This Hero')).toBeTruthy();
    expect(getByText('Back to Start')).toBeTruthy();
  });

  it('shows empty state when details generation fails', async () => {
    (charactersApi.post as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/generate')) return Promise.reject(new Error('Generation failed'));
      return Promise.resolve({ data: {} });
    });

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

    // Wait for the background image to be generated so the Adopt button is enabled
    await waitFor(() => {
      expect(charactersApi.post).toHaveBeenCalledWith('/characters/char-id-123/generate-image');
    });

    // Click "Adopt This Hero"
    fireEvent.press(getByText('Adopt This Hero'));

    await waitFor(() => {
      // Verifies character adopt endpoint called
      expect(charactersApi.post).toHaveBeenCalledWith('/characters/char-id-123/adopt');

      // Verifies profilesApi.post was called with correct structure
      expect(profilesApi.post).toHaveBeenCalledWith('/profiles/', expect.objectContaining({
        display_name: 'Aethelgard Moonwhisper',
        tagline: 'The forest speaks to those who listen.',
        bio: 'A wandering elven druid.',
        is_oc: false,
        generated: true,
        image_urls: ['http://example.com/portrait.jpg'],
        fandom: [{ id: 'tag-dnd', category: 'fandom', name: 'D&D', slug: 'fandom__dnd' }],
        race: [{ id: 'tag-elf', category: 'race', name: 'Elf', slug: 'race__elf' }],
        gender: [{ id: 'tag-male', category: 'gender', name: 'Male', slug: 'gender__male' }],
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
    // Mock profiles post to fail
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

    // Wait for the background image to be generated so the Adopt button is enabled
    await waitFor(() => {
      expect(charactersApi.post).toHaveBeenCalledWith('/characters/char-id-123/generate-image');
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

  it('allows regenerating the profile and the portrait', async () => {
    const { getByText, getByTestId } = render(<CharacterWizardScreen />, { wrapper: createWrapper() });

    // Navigate to step 5
    fireEvent.press(getByText('Dungeons & Dragons'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByText('Male'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByText('Elf'));
    fireEvent.press(getByTestId('wizard-next-button'));
    fireEvent.press(getByText('Fighter'));
    fireEvent.press(getByTestId('wizard-next-button'));

    // Wait for the character to generate
    await waitFor(() => {
      expect(getByText('Aethelgard Moonwhisper')).toBeTruthy();
    });

    // Check that "Next Profile" and "New Portrait" buttons are visible
    const nextProfileBtn = getByText('Next Profile');
    const newPortraitBtn = getByText('New Portrait');
    expect(nextProfileBtn).toBeTruthy();
    expect(newPortraitBtn).toBeTruthy();

    // Clear mock calls
    (charactersApi.post as jest.Mock).mockClear();

    // Trigger New Portrait
    fireEvent.press(newPortraitBtn);
    await waitFor(() => {
      // Assert that another generate-image call is made
      expect(charactersApi.post).toHaveBeenCalledWith('/characters/char-id-123/generate-image');
    });

    // Clear mock calls again
    (charactersApi.post as jest.Mock).mockClear();

    // Trigger Next Profile
    fireEvent.press(nextProfileBtn);
    await waitFor(() => {
      // Assert that details generation was triggered again
      expect(charactersApi.post).toHaveBeenCalledWith('/characters/generate', expect.any(Object));
    });
  });
});

