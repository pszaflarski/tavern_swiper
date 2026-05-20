import React from 'react';
import { render, screen, act } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import ConversationScreen from '../../screens/ConversationScreen';
import { useLocalSearchParams } from 'expo-router';
import { useProfileContext } from '../../context/ProfileContext';
import { useInvolvedMatches, useConversationMessages, useSendMessage, useRollDice } from '../../hooks/useMessages';

// Silence VirtualizedList act() warnings internal to FlatList
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    const message = args[0]?.toString() || '';
    if (
      message.includes('VirtualizedList inside a test was not wrapped in act') ||
      message.includes('was not wrapped in act(...)')
    ) {
      return;
    }
    originalError(...args);
  };
});
afterAll(() => {
  console.error = originalError;
});

// --- Mocks ---
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useLocalSearchParams: jest.fn(),
    useNavigation: jest.fn(() => ({
      getParent: jest.fn(() => ({
        setOptions: jest.fn(),
      })),
    })),
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
    Stack: { Screen: jest.fn(() => null) },
  };
});

jest.mock('../../context/ProfileContext', () => ({
  useProfileContext: jest.fn(),
}));

jest.mock('../../hooks/useMessages', () => ({
  useInvolvedMatches: jest.fn(),
  useConversationMessages: jest.fn(),
  useSendMessage: jest.fn(),
  useRollDice: jest.fn(() => ({
    mutateAsync: jest.fn(),
    invalidateAfterRoll: jest.fn(),
  })),
}));

// DiceOverlay mock — captures props so we can invoke onResult/onDismiss
let capturedDiceOverlayProps: Record<string, any> = {};
jest.mock('../../components/DiceOverlay', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: any) => {
      capturedDiceOverlayProps = props;
      return null;
    },
  };
});

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 400, height: 800 }),
}));

// --- Helpers ---
const T0 = '2026-05-20T10:00:00Z';
const T1 = '2026-05-20T10:00:01Z';
const T2 = '2026-05-20T10:00:02Z';
const T3 = '2026-05-20T10:00:03Z';
const T4 = '2026-05-20T10:00:04Z';
const T5 = '2026-05-20T10:00:05Z';

function makeUserMsg(id: string, sentAt: string, content = 'Hello') {
  return {
    message_id: id,
    conversation_id: 'c1',
    sender_profile_id: 'p2',
    content,
    type: 'user' as const,
    sent_at: sentAt,
  };
}

function makeDiceRollEvent(id: string, sentAt: string, dieType = 'd6', value = 4) {
  return {
    message_id: id,
    conversation_id: 'c1',
    sender_profile_id: 'p2',
    content: `Lira rolled a ${value} on a ${dieType}`,
    type: 'event' as const,
    sent_at: sentAt,
    metadata: {
      event_type: 'dice_roll',
      initiated_by: 'p2',
      metadata: { value, item_name: dieType },
    },
  };
}

function makeNarration(id: string, sentAt: string, content: string) {
  return {
    message_id: id,
    conversation_id: 'c1',
    sender_profile_id: 'p2',
    content,
    type: 'event' as const,
    sent_at: sentAt,
    metadata: {
      event_type: 'narration',
      initiated_by: 'p2',
    },
  };
}

const mockConvoMessages = jest.fn();

function setupMocks(messages: any[]) {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'c1' });
  (useProfileContext as jest.Mock).mockReturnValue({ activeProfileId: 'p1' });
  (useInvolvedMatches as jest.Mock).mockReturnValue({
    inbox: [{ id: 'c1', otherProfile: { profile_id: 'p2', display_name: 'Lira', image_urls: [] } }],
    isLoading: false,
  });
  mockConvoMessages.mockReturnValue({
    data: messages,
    isLoading: false,
    fetchNextPage: jest.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  });
  (useConversationMessages as jest.Mock).mockImplementation(mockConvoMessages);
  (useSendMessage as jest.Mock).mockReturnValue({ mutate: jest.fn(), isPending: false });
}

function getFlatListData(): any[] {
  const { FlatList } = require('react-native');
  // The UNSAFE_getByType approach doesn't work well across rerenders,
  // so we check screen content instead. Return the captured overlay props.
  return [];
}

function getVisibleMessageIds(container: any): string[] {
  const { FlatList } = require('react-native');
  const flatList = container.UNSAFE_getByType(FlatList);
  return (flatList.props.data || []).map((m: any) => m.message_id);
}

// --- Tests ---
describe('Dice Animation Queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedDiceOverlayProps = {};
  });

  describe('Watermark — initial load skips old dice rolls', () => {
    it('does not animate dice_roll events that existed when the conversation opened', () => {
      const initialMessages = [
        makeUserMsg('m1', T0, 'Hey'),
        makeDiceRollEvent('m2', T1, 'd6', 3),
        makeUserMsg('m3', T2, 'Nice roll'),
      ];
      setupMocks(initialMessages);

      render(<ConversationScreen />);

      // The DiceOverlay should not be visible — old rolls are watermarked out
      expect(capturedDiceOverlayProps.visible).toBe(false);
    });

    it('shows all initial messages (including old dice_roll events) in the FlatList', () => {
      const initialMessages = [
        makeUserMsg('m1', T0, 'Hey'),
        makeDiceRollEvent('m2', T1, 'd6', 3),
        makeUserMsg('m3', T2, 'Nice roll'),
      ];
      setupMocks(initialMessages);

      const container = render(<ConversationScreen />);
      const ids = getVisibleMessageIds(container);
      // All 3 messages should be visible (inverted order: newest first)
      expect(ids).toEqual(['m3', 'm2', 'm1']);
    });
  });

  describe('Enqueue — new dice_roll events trigger animation', () => {
    it('starts animation when a new dice_roll event arrives after watermark', () => {
      const initialMessages = [
        makeUserMsg('m1', T0, 'Hey'),
        makeUserMsg('m2', T1, 'Yo'),
      ];
      setupMocks(initialMessages);

      const container = render(<ConversationScreen />);

      // Animation should not be active yet
      expect(capturedDiceOverlayProps.visible).toBe(false);

      // Simulate a new dice_roll event arriving via polling
      const updatedMessages = [
        ...initialMessages,
        makeDiceRollEvent('m3', T2, 'd20', 17),
      ];
      mockConvoMessages.mockReturnValue({
        data: updatedMessages,
        isLoading: false,
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      });

      act(() => {
        container.rerender(<ConversationScreen />);
      });

      // Now the DiceOverlay should be visible with the correct die and value
      expect(capturedDiceOverlayProps.visible).toBe(true);
      expect(capturedDiceOverlayProps.dieType).toBe('d20');
      expect(capturedDiceOverlayProps.desiredValue).toBe(17);
    });

    it('does not re-enqueue the same dice_roll event on subsequent rerenders', () => {
      const initialMessages = [makeUserMsg('m1', T0, 'Hey')];
      setupMocks(initialMessages);

      const container = render(<ConversationScreen />);

      const withDice = [...initialMessages, makeDiceRollEvent('m2', T1, 'd6', 4)];
      mockConvoMessages.mockReturnValue({
        data: withDice,
        isLoading: false,
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      });

      // Rerender twice with the same messages
      act(() => { container.rerender(<ConversationScreen />); });
      const rollKey1 = capturedDiceOverlayProps.rollKey;

      act(() => { container.rerender(<ConversationScreen />); });
      const rollKey2 = capturedDiceOverlayProps.rollKey;

      // rollKey should not have incremented again on the second rerender
      expect(rollKey2).toBe(rollKey1);
    });
  });

  describe('Message hiding — hides messages during animation', () => {
    it('hides the dice_roll event AND follow-up messages while animating', () => {
      const initialMessages = [makeUserMsg('m1', T0, 'Hey')];
      setupMocks(initialMessages);

      const container = render(<ConversationScreen />);

      // New dice roll + Lira's follow-up arrive together
      const updatedMessages = [
        ...initialMessages,
        makeDiceRollEvent('m2', T1, 'd6', 5),
        makeNarration('m3', T2, 'Lira smirks at the result.'),
        makeUserMsg('m4', T3, 'Ha! Beat that!'),
      ];
      mockConvoMessages.mockReturnValue({
        data: updatedMessages,
        isLoading: false,
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      });

      act(() => { container.rerender(<ConversationScreen />); });

      // Only m1 should be visible — m2 (dice), m3 (narration), m4 (follow-up)
      // are all hidden because they arrived at or after the dice_roll's sent_at
      const ids = getVisibleMessageIds(container);
      expect(ids).toEqual(['m1']);
    });

    it('reveals all hidden messages after animation completes', () => {
      const initialMessages = [makeUserMsg('m1', T0, 'Hey')];
      setupMocks(initialMessages);

      const container = render(<ConversationScreen />);

      // Dice roll + follow-ups arrive
      const updatedMessages = [
        ...initialMessages,
        makeDiceRollEvent('m2', T1, 'd6', 5),
        makeNarration('m3', T2, 'Lira smirks.'),
        makeUserMsg('m4', T3, 'Not bad!'),
      ];
      mockConvoMessages.mockReturnValue({
        data: updatedMessages,
        isLoading: false,
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      });

      act(() => { container.rerender(<ConversationScreen />); });

      // Verify messages are hidden
      expect(getVisibleMessageIds(container)).toEqual(['m1']);

      // Simulate animation completing
      act(() => {
        capturedDiceOverlayProps.onResult(5);
      });
      // Force rerender to pick up state changes
      act(() => { container.rerender(<ConversationScreen />); });

      // Now all messages should be visible (inverted: newest first)
      const ids = getVisibleMessageIds(container);
      expect(ids).toEqual(['m4', 'm3', 'm2', 'm1']);
    });
  });

  describe('Queue processing — sequential animations', () => {
    it('processes multiple dice rolls one at a time', () => {
      const initialMessages = [makeUserMsg('m1', T0, 'Hey')];
      setupMocks(initialMessages);

      const container = render(<ConversationScreen />);

      // Two dice rolls arrive at once
      const updatedMessages = [
        ...initialMessages,
        makeDiceRollEvent('m2', T1, 'd6', 3),
        makeDiceRollEvent('m3', T2, 'd20', 18),
      ];
      mockConvoMessages.mockReturnValue({
        data: updatedMessages,
        isLoading: false,
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      });

      act(() => { container.rerender(<ConversationScreen />); });

      // First animation should be the d6 roll
      expect(capturedDiceOverlayProps.visible).toBe(true);
      expect(capturedDiceOverlayProps.dieType).toBe('d6');
      expect(capturedDiceOverlayProps.desiredValue).toBe(3);

      // Complete the first animation
      act(() => { capturedDiceOverlayProps.onResult(3); });
      act(() => { container.rerender(<ConversationScreen />); });

      // Second animation should now be the d20 roll
      expect(capturedDiceOverlayProps.visible).toBe(true);
      expect(capturedDiceOverlayProps.dieType).toBe('d20');
      expect(capturedDiceOverlayProps.desiredValue).toBe(18);
    });

    it('reveals messages between dice rolls after first animation completes', () => {
      const initialMessages = [makeUserMsg('m1', T0, 'Hey')];
      setupMocks(initialMessages);

      const container = render(<ConversationScreen />);

      // Roll 1 at T1, Lira comment at T2, Roll 2 at T3, Lira comment at T4
      const updatedMessages = [
        ...initialMessages,
        makeDiceRollEvent('m2', T1, 'd6', 3),
        makeUserMsg('m3', T2, 'Not bad!'),
        makeDiceRollEvent('m4', T3, 'd20', 18),
        makeUserMsg('m5', T4, 'Wow!'),
      ];
      mockConvoMessages.mockReturnValue({
        data: updatedMessages,
        isLoading: false,
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      });

      act(() => { container.rerender(<ConversationScreen />); });

      // During first animation: only m1 visible (everything T1+ hidden)
      expect(getVisibleMessageIds(container)).toEqual(['m1']);

      // Complete first animation
      act(() => { capturedDiceOverlayProps.onResult(3); });
      act(() => { container.rerender(<ConversationScreen />); });

      // m2 and m3 revealed (they're before T3), m4 and m5 still hidden
      expect(getVisibleMessageIds(container)).toEqual(['m3', 'm2', 'm1']);

      // Complete second animation
      act(() => { capturedDiceOverlayProps.onResult(18); });
      act(() => { container.rerender(<ConversationScreen />); });

      // Everything visible now
      expect(getVisibleMessageIds(container)).toEqual(['m5', 'm4', 'm3', 'm2', 'm1']);
    });
  });

  describe('Dismiss — clears queue and reveals all', () => {
    it('reveals all messages when the overlay is dismissed', () => {
      const initialMessages = [makeUserMsg('m1', T0, 'Hey')];
      setupMocks(initialMessages);

      const container = render(<ConversationScreen />);

      const updatedMessages = [
        ...initialMessages,
        makeDiceRollEvent('m2', T1, 'd6', 5),
        makeUserMsg('m3', T2, 'Follow-up'),
      ];
      mockConvoMessages.mockReturnValue({
        data: updatedMessages,
        isLoading: false,
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
      });

      act(() => { container.rerender(<ConversationScreen />); });

      // Messages hidden during animation
      expect(getVisibleMessageIds(container)).toEqual(['m1']);

      // User dismisses the overlay
      act(() => { capturedDiceOverlayProps.onDismiss(); });
      act(() => { container.rerender(<ConversationScreen />); });

      // All messages revealed, overlay hidden
      expect(getVisibleMessageIds(container)).toEqual(['m3', 'm2', 'm1']);
      expect(capturedDiceOverlayProps.visible).toBe(false);
    });
  });
});
