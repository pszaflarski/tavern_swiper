import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import InventoryScreen from '../../screens/InventoryScreen';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

// Mock expo-router
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

describe('Inventory Screen', () => {
  const mockRouter = {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => true),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
  });

  // -----------------------------------------------------------------------
  // Grid View
  // -----------------------------------------------------------------------
  describe('Grid View', () => {
    it('renders all inventory items in the grid', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});

      render(<InventoryScreen />);

      expect(screen.getByTestId('inventory-item-gold')).toBeTruthy();
      expect(screen.getByTestId('inventory-item-dice_d4')).toBeTruthy();
      expect(screen.getByTestId('inventory-item-dice_d6')).toBeTruthy();
      expect(screen.getByTestId('inventory-item-dice_d8')).toBeTruthy();
      expect(screen.getByTestId('inventory-item-dice_d12')).toBeTruthy();
      expect(screen.getByTestId('inventory-item-dice_d20')).toBeTruthy();
    });

    it('shows item names and quantities', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});

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

      render(<InventoryScreen />);

      fireEvent.press(screen.getByTestId('inventory-item-dice_d6'));

      // Detail view should show the item's description
      expect(screen.getByText(/classic six-sided die/i)).toBeTruthy();
      expect(screen.getByText('×12 in pouch')).toBeTruthy();
    });

    it('returns to grid view when back button is pressed from detail', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});

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

      // Grid should be visible again (rerender picked up the state change)
      // Since we rendered HeaderLeft separately, we verify router.back was NOT called
      // (the goBack function clears selectedItem first)
      expect(mockRouter.back).not.toHaveBeenCalled();
    });

    it('shows correct action buttons for gold (trade, gift)', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});

      render(<InventoryScreen />);

      fireEvent.press(screen.getByTestId('inventory-item-gold'));

      expect(screen.getByTestId('item-action-trade')).toBeTruthy();
      expect(screen.getByTestId('item-action-gift')).toBeTruthy();
      expect(screen.queryByTestId('item-action-use')).toBeNull();
      expect(screen.queryByTestId('item-action-equip')).toBeNull();
    });

    it('shows correct action buttons for dice (use only)', () => {
      (useLocalSearchParams as jest.Mock).mockReturnValue({});

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
});
