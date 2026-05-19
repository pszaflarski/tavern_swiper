import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import InventoryScreen from '../../screens/InventoryScreen';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { InventoryEntry } from '../../hooks/useInventory';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock expo-router (override the global default)
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useLocalSearchParams: jest.fn(),
    useRouter: jest.fn(),
    Stack: {
      Screen: jest.fn(() => null),
    },
  };
});

// Mock useUser
jest.mock('../../hooks/useUser', () => ({
  useUser: jest.fn(),
}));
import { useUser } from '../../hooks/useUser';

// Mock useInventory
jest.mock('../../hooks/useInventory', () => ({
  useInventory: jest.fn(),
}));
import { useInventory } from '../../hooks/useInventory';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const MOCK_INVENTORY: InventoryEntry[] = [
  {
    item_id: 'gold',
    quantity: 350,
    acquired_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    name: 'Gold',
    description: 'The universal currency of the realm.',
    image_url: '',
    category: 'currency',
    rarity: 'common',
    actions: ['trade', 'gift'],
  },
  {
    item_id: 'dice_d6',
    quantity: 12,
    acquired_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    name: 'Standard D6 Dice',
    description: 'The classic six-sided die. Reliable and sturdy.',
    image_url: '',
    category: 'key_item',
    rarity: 'common',
    actions: ['use'],
  },
  {
    item_id: 'dice_d20',
    quantity: 1,
    acquired_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    name: 'Standard D20 Dice',
    description: 'The legendary twenty-sided die.',
    image_url: '',
    category: 'key_item',
    rarity: 'common',
    actions: ['use'],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Inventory Screen', () => {
  const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
  };

  const mockRefetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useUser as jest.Mock).mockReturnValue({ uid: 'user1' });
  });

  /** Helper to set up the inventory hook mock with loaded data */
  function mockInventoryLoaded(data: InventoryEntry[] = MOCK_INVENTORY) {
    (useInventory as jest.Mock).mockReturnValue({
      data,
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });
  }

  /** Helper to set up the inventory hook mock in loading state */
  function mockInventoryLoading() {
    (useInventory as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockRefetch,
    });
  }

  /** Helper to set up the inventory hook mock in error state */
  function mockInventoryError() {
    (useInventory as jest.Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    });
  }

  // -----------------------------------------------------------------------
  // Loading State
  // -----------------------------------------------------------------------
  describe('Loading State', () => {
    it('renders a loading indicator while fetching inventory', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryLoading();

      render(<InventoryScreen />);

      expect(screen.getByText(/opening your pouch/i)).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Error State
  // -----------------------------------------------------------------------
  describe('Error State', () => {
    it('renders an error message when the fetch fails', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryError();

      render(<InventoryScreen />);

      expect(screen.getByText(/failed to load inventory/i)).toBeTruthy();
    });

    it('calls refetch when Try Again is pressed', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryError();

      render(<InventoryScreen />);

      fireEvent.press(screen.getByText(/try again/i));

      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Empty State
  // -----------------------------------------------------------------------
  describe('Empty State', () => {
    it('renders the empty pouch message when inventory is empty', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryLoaded([]);

      render(<InventoryScreen />);

      expect(screen.getByText(/your pouch is empty/i)).toBeTruthy();
      expect(screen.getByText(/complete quests/i)).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Grid View
  // -----------------------------------------------------------------------
  describe('Grid View', () => {
    it('renders all inventory items in the grid', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryLoaded();

      render(<InventoryScreen />);

      expect(screen.getByTestId('inventory-item-gold')).toBeTruthy();
      expect(screen.getByTestId('inventory-item-dice_d6')).toBeTruthy();
      expect(screen.getByTestId('inventory-item-dice_d20')).toBeTruthy();
    });

    it('shows item names and quantities', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryLoaded();

      render(<InventoryScreen />);

      expect(screen.getByText('Gold')).toBeTruthy();
      expect(screen.getByText('×350')).toBeTruthy();
      expect(screen.getByText('Standard D6 Dice')).toBeTruthy();
      expect(screen.getByText('×12')).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Detail View
  // -----------------------------------------------------------------------
  describe('Detail View', () => {
    it('opens detail view when an item is tapped', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryLoaded();

      render(<InventoryScreen />);

      fireEvent.press(screen.getByTestId('inventory-item-dice_d6'));

      expect(screen.getByText(/classic six-sided die/i)).toBeTruthy();
      expect(screen.getByText('×12 in pouch')).toBeTruthy();
    });

    it('returns to grid view when back button is pressed from detail', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryLoaded();

      render(<InventoryScreen />);

      // Open detail
      fireEvent.press(screen.getByTestId('inventory-item-gold'));
      expect(screen.getByText(/universal currency/i)).toBeTruthy();

      // Extract the headerLeft from Stack.Screen and render it
      const stackCalls = (Stack.Screen as jest.Mock).mock.calls;
      const lastCall = stackCalls[stackCalls.length - 1][0];
      const HeaderLeft = lastCall.options.headerLeft;
      const { getByTestId } = render(<HeaderLeft />);

      // Press back — should return to grid (not navigate away)
      fireEvent.press(getByTestId('inventory-back-button'));

      // Since we rendered HeaderLeft separately, we verify router.back was NOT called
      // (the goBack function clears selectedItem first)
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    it('shows correct action buttons for gold (trade, gift)', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryLoaded();

      render(<InventoryScreen />);

      fireEvent.press(screen.getByTestId('inventory-item-gold'));

      expect(screen.getByTestId('item-action-trade')).toBeTruthy();
      expect(screen.getByTestId('item-action-gift')).toBeTruthy();
      expect(screen.queryByTestId('item-action-use')).toBeNull();
      expect(screen.queryByTestId('item-action-equip')).toBeNull();
    });

    it('shows correct action buttons for dice (use only)', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryLoaded();

      render(<InventoryScreen />);

      fireEvent.press(screen.getByTestId('inventory-item-dice_d20'));

      expect(screen.getByTestId('item-action-use')).toBeTruthy();
      expect(screen.queryByTestId('item-action-trade')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Opened from Account (no conversation context)
  // -----------------------------------------------------------------------
  describe('opened from Account (no conversationId)', () => {
    beforeEach(() => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryLoaded();
    });

    it('disables all action buttons', () => {
      render(<InventoryScreen />);

      fireEvent.press(screen.getByTestId('inventory-item-gold'));

      const tradeBtn = screen.getByTestId('item-action-trade');
      const giftBtn = screen.getByTestId('item-action-gift');

      expect(tradeBtn.props.accessibilityState?.disabled).toBe(true);
      expect(giftBtn.props.accessibilityState?.disabled).toBe(true);
    });

    it('shows hint text about opening from a conversation', () => {
      render(<InventoryScreen />);

      fireEvent.press(screen.getByTestId('inventory-item-dice_d6'));

      expect(
        screen.getByText(/open your inventory from a conversation to use items/i)
      ).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // Opened from Conversation (with context)
  // -----------------------------------------------------------------------
  describe('opened from Conversation (with conversationId)', () => {
    beforeEach(() => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({
        conversationId: 'conv-123',
        profileId: 'profile-456',
      });
      mockInventoryLoaded();
    });

    it('enables action buttons', () => {
      render(<InventoryScreen />);

      fireEvent.press(screen.getByTestId('inventory-item-dice_d6'));

      const useBtn = screen.getByTestId('item-action-use');
      expect(useBtn.props.accessibilityState?.disabled).toBeFalsy();
    });

    it('does not show the disabled hint', () => {
      render(<InventoryScreen />);

      fireEvent.press(screen.getByTestId('inventory-item-dice_d6'));

      expect(
        screen.queryByText(/open your inventory from a conversation/i)
      ).toBeNull();
    });

    it('navigates back to conversation with equippedDie when Use is pressed', () => {
      render(<InventoryScreen />);

      fireEvent.press(screen.getByTestId('inventory-item-dice_d6'));
      fireEvent.press(screen.getByTestId('item-action-use'));

      expect(mockRouter.replace).toHaveBeenCalledWith(
        expect.objectContaining({
          pathname: '/(tabs)/messages/[id]',
          params: expect.objectContaining({
            id: 'conv-123',
            equippedDie: 'd6',
          }),
        })
      );
    });
  });

  // -----------------------------------------------------------------------
  // Navigation — back button
  // -----------------------------------------------------------------------
  describe('Navigation', () => {
    it('calls router.back() when X is pressed and there is history', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryLoaded();
      mockRouter.canGoBack.mockReturnValue(true);

      render(<InventoryScreen />);

      // Extract headerLeft from Stack.Screen mock
      const stackCalls = (Stack.Screen as jest.Mock).mock.calls;
      const lastCall = stackCalls[stackCalls.length - 1][0];
      const HeaderLeft = lastCall.options.headerLeft;
      const { getByTestId } = render(<HeaderLeft />);

      fireEvent.press(getByTestId('inventory-back-button'));

      expect(mockRouter.back).toHaveBeenCalled();
    });

    it('falls back to account screen when no history', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      mockInventoryLoaded();
      mockRouter.canGoBack.mockReturnValue(false);

      render(<InventoryScreen />);

      // Extract headerLeft from Stack.Screen mock
      const stackCalls = (Stack.Screen as jest.Mock).mock.calls;
      const lastCall = stackCalls[stackCalls.length - 1][0];
      const HeaderLeft = lastCall.options.headerLeft;
      const { getByTestId } = render(<HeaderLeft />);

      fireEvent.press(getByTestId('inventory-back-button'));

      expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/account');
    });
  });

  // -----------------------------------------------------------------------
  // Hook Integration
  // -----------------------------------------------------------------------
  describe('Hook Integration', () => {
    it('passes the user UID to useInventory', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      (useUser as jest.Mock).mockReturnValue({ uid: 'my-user-id' });
      mockInventoryLoaded([]);

      render(<InventoryScreen />);

      expect(useInventory).toHaveBeenCalledWith('my-user-id');
    });

    it('handles undefined uid gracefully', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});
      (useUser as jest.Mock).mockReturnValue({ uid: undefined });
      mockInventoryLoading();

      render(<InventoryScreen />);

      expect(useInventory).toHaveBeenCalledWith(undefined);
      // Should show loading state when uid is not yet available
      expect(screen.getByText(/opening your pouch/i)).toBeTruthy();
    });
  });
});
