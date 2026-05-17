import React from 'react';
import { render, fireEvent, act, screen } from '@testing-library/react-native';
import ConversationScreen from '../../screens/ConversationScreen';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useProfileContext } from '../../context/ProfileContext';
import { useInvolvedMatches, useConversationMessages, useSendMessage } from '../../hooks/useMessages';

// Silence the VirtualizedList act() warning which is internal to React Native's FlatList
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

// Mock hooks
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
    router: {
      push: jest.fn(),
      back: jest.fn(),
      replace: jest.fn(),
    },
    Stack: {
      Screen: jest.fn(() => null),
    },
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

// DiceOverlay uses @react-three/fiber, three.js, cannon-es — none of which
// work in the Jest jsdom environment. Mock the entire component tree.
jest.mock('../../components/DiceOverlay', () => {
  const React = require('react');
  return { __esModule: true, default: () => null };
});
jest.mock('../../components/DiceOverlay/DiceTypeBar', () => {
  const React = require('react');
  return { __esModule: true, default: ({ onSelectDie }: any) => null };
});

describe('Conversation Screen', () => {
  const mockConversationId = 'c1';
  const mockActiveProfileId = 'p1';
  
  const mockOtherProfile = {
    profile_id: 'p2',
    display_name: 'Elora',
    image_urls: ['http://example.com/elora.jpg'],
  };

  const mockInbox = [
    {
      id: 'c1',
      otherProfile: mockOtherProfile,
    },
  ];

  const mockMessages = [
    {
      message_id: 'm1',
      conversation_id: 'c1',
      sender_profile_id: 'p2',
      content: 'Greetings, traveler!',
      type: 'user',
      sent_at: new Date(Date.now() - 10000).toISOString(),
    },
    {
      message_id: 'm2',
      conversation_id: 'c1',
      sender_profile_id: 'p1',
      content: 'Well met!',
      type: 'user',
      sent_at: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: mockConversationId });
    (useProfileContext as jest.Mock).mockReturnValue({ activeProfileId: mockActiveProfileId });
    (useInvolvedMatches as jest.Mock).mockReturnValue({
      inbox: mockInbox,
      isLoading: false,
      isError: false,
    });
    (useConversationMessages as jest.Mock).mockReturnValue({
      data: mockMessages,
      isLoading: false,
      isError: false,
    });
    (useSendMessage as jest.Mock).mockReturnValue({
      mutate: jest.fn(),
      isPending: false,
    });
  });

  it('renders conversation details and messages correctly', () => {
    render(<ConversationScreen />);

    // Messages
    expect(screen.getByText('Greetings, traveler!')).toBeTruthy();
    expect(screen.getByText('Well met!')).toBeTruthy();
    
    // Verify Stack.Screen was called with correct header options (declarative side)
    expect(Stack.Screen).toHaveBeenCalled();
    const props = (Stack.Screen as jest.Mock).mock.calls[0][0];
    expect(props.options.headerTitle).toBe('');
    expect(props.options.headerShadowVisible).toBe(false);
  });

  it('allows sending a new message', () => {
    const mockMutate = jest.fn();
    (useSendMessage as jest.Mock).mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    });

    render(<ConversationScreen />);
    
    // Find input and type
    const input = screen.getByTestId('message-input');
    fireEvent.changeText(input, 'I seek adventure!');
    
    // Find send button and press
    const sendButton = screen.getByTestId('send-button');
    fireEvent.press(sendButton);
    
    expect(mockMutate).toHaveBeenCalledWith({
      conversationId: mockConversationId,
      senderProfileId: mockActiveProfileId,
      content: 'I seek adventure!',
    });
  });

  it('shows empty state when no messages exist', () => {
    (useConversationMessages as jest.Mock).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    render(<ConversationScreen />);
    expect(screen.getByText('The air is thick with unspoken words.')).toBeTruthy();
  });

  it('shows loading state when fetching messages', () => {
    (useConversationMessages as jest.Mock).mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
    });

    render(<ConversationScreen />);
    expect(screen.getByText('Reading the scrolls...')).toBeTruthy();
  });

  it('navigates to messages list when back button is pressed', () => {
    const { router } = require('expo-router');
    render(<ConversationScreen />);
    
    // The back button is in the headerLeft option of Stack.Screen
    expect(Stack.Screen).toHaveBeenCalled();
    const props = (Stack.Screen as jest.Mock).mock.calls[0][0];
    const HeaderLeft = props.options.headerLeft;
    
    // Render the header component to interact with it
    const { getByTestId } = render(<HeaderLeft />);
    
    const backButton = getByTestId('back-button');
    fireEvent.press(backButton);
    
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/messages');
  });

  it('uses an inverted FlatList so newest messages appear at the bottom without scrollToEnd', () => {
    const { UNSAFE_getByType } = render(<ConversationScreen />);
    const { FlatList } = require('react-native');
    const flatList = UNSAFE_getByType(FlatList);

    // The FlatList must be inverted — this is the core of the scroll fix.
    // Inverted lists render from the bottom up, so the newest message
    // (index 0 in the reversed data) sits at the scroll origin.
    expect(flatList.props.inverted).toBe(true);
  });

  it('feeds messages in reversed order so newest message is at index 0', () => {
    const { UNSAFE_getByType } = render(<ConversationScreen />);
    const { FlatList } = require('react-native');
    const flatList = UNSAFE_getByType(FlatList);

    const data = flatList.props.data;
    expect(data.length).toBe(2);
    // In an inverted list, the first item in the data array renders at the
    // bottom of the screen. So the newest message (m2) must be at index 0.
    expect(data[0].message_id).toBe('m2');
    expect(data[1].message_id).toBe('m1');
  });

  it('keeps newest message at scroll origin when new messages arrive', () => {
    const { UNSAFE_getByType, rerender } = render(<ConversationScreen />);
    const { FlatList } = require('react-native');

    // Simulate a new message arriving via polling
    const updatedMessages = [
      ...mockMessages,
      {
        message_id: 'm3',
        conversation_id: 'c1',
        sender_profile_id: 'p2',
        content: 'A new quest awaits!',
        type: 'user',
        sent_at: new Date().toISOString(),
      },
    ];
    (useConversationMessages as jest.Mock).mockReturnValue({
      data: updatedMessages,
      isLoading: false,
      isError: false,
    });

    rerender(<ConversationScreen />);
    const flatList = UNSAFE_getByType(FlatList);

    const data = flatList.props.data;
    expect(data.length).toBe(3);
    // Newest message should be at index 0 (scroll origin of inverted list)
    expect(data[0].message_id).toBe('m3');
    expect(data[0].content).toBe('A new quest awaits!');
  });
});
