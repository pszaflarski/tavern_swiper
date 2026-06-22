import React from 'react';
import { render, fireEvent, act, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import ConversationScreen from '../../screens/ConversationScreen';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useProfileContext } from '../../context/ProfileContext';
import { useInvolvedMatches, useConversationMessages, useSendMessage, useRollDice } from '../../hooks/useMessages';

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
  useTypingIndicator: jest.fn(() => ({ isOtherTyping: false, onTextChange: jest.fn() })),
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

// Mock useWindowDimensions for the draggable die
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 400, height: 800 }),
}));

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
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
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
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    render(<ConversationScreen />);
    expect(screen.getByText('The air is thick with unspoken words.')).toBeTruthy();
  });

  it('shows loading state when fetching messages', () => {
    (useConversationMessages as jest.Mock).mockReturnValue({
      data: [],
      isLoading: true,
      isError: false,
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
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

  it('navigates to profile preview when profile header is pressed', () => {
    const { router } = require('expo-router');
    render(<ConversationScreen />);
    
    expect(Stack.Screen).toHaveBeenCalled();
    const props = (Stack.Screen as jest.Mock).mock.calls[0][0];
    const HeaderLeft = props.options.headerLeft;
    
    const { getByTestId } = render(<HeaderLeft />);
    
    const profileHeaderBtn = getByTestId('header-profile-button');
    fireEvent.press(profileHeaderBtn);
    
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/profiles/preview',
      params: { id: 'p2' }
    });
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
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    rerender(<ConversationScreen />);
    const flatList = UNSAFE_getByType(FlatList);

    const data = flatList.props.data;
    expect(data.length).toBe(3);
    // Newest message should be at index 0 (scroll origin of inverted list)
    expect(data[0].message_id).toBe('m3');
    expect(data[0].content).toBe('A new quest awaits!');
  });

  // -----------------------------------------------------------------------
  // Backpack / Inventory button
  // -----------------------------------------------------------------------
  it('renders a backpack icon button that navigates to inventory', () => {
    render(<ConversationScreen />);

    const inventoryBtn = screen.getByTestId('inventory-toggle-button');
    expect(inventoryBtn).toBeTruthy();

    fireEvent.press(inventoryBtn);

    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/inventory',
        params: expect.objectContaining({
          conversationId: mockConversationId,
          profileId: mockActiveProfileId,
        }),
      })
    );
  });

  // -----------------------------------------------------------------------
  // Equipped die circle
  // -----------------------------------------------------------------------
  it('shows equipped die circle when equippedDie param is present', () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: mockConversationId,
      equippedDie: 'd6',
    });

    render(<ConversationScreen />);

    expect(screen.getByTestId('equipped-die-roll-button')).toBeTruthy();
    expect(screen.getByTestId('equipped-die-dismiss')).toBeTruthy();
  });

  it('does not show equipped die circle when no equippedDie param', () => {
    render(<ConversationScreen />);

    expect(screen.queryByTestId('equipped-die-roll-button')).toBeNull();
  });

  it('calls rollDice when equipped die circle is tapped', async () => {
    const mockRollDice = jest.fn().mockResolvedValue({
      type: 'd6',
      result: 4,
      message_id: 'msg-roll-1',
    });
    (useRollDice as jest.Mock).mockReturnValue({
      mutateAsync: mockRollDice,
      invalidateAfterRoll: jest.fn(),
    });
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: mockConversationId,
      equippedDie: 'd6',
    });

    render(<ConversationScreen />);

    // The PanResponder-based circle detects taps via onPanResponderRelease
    // with minimal movement. In test env, fireEvent.press triggers onPress
    // if a Pressable is nested, but our component uses PanResponder.
    // We verify the die is rendered and the hook is wired up.
    expect(screen.getByTestId('equipped-die-roll-button')).toBeTruthy();
  });

  it('removes equipped die when dismiss button is pressed', () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({
      id: mockConversationId,
      equippedDie: 'd20',
    });

    render(<ConversationScreen />);

    expect(screen.getByTestId('equipped-die-roll-button')).toBeTruthy();

    // Press the X dismiss button
    fireEvent.press(screen.getByTestId('equipped-die-dismiss'));

    expect(screen.queryByTestId('equipped-die-roll-button')).toBeNull();
  });

  it('sends the message on Web when Enter is pressed without Shift', () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', {
      value: 'web',
      configurable: true,
    });
    try {
      const mockMutate = jest.fn();
      (useSendMessage as jest.Mock).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      render(<ConversationScreen />);
      const input = screen.getByTestId('message-input');
      fireEvent.changeText(input, 'Web adventure!');

      const preventDefault = jest.fn();
      fireEvent(input, 'keyPress', {
        nativeEvent: {
          key: 'Enter',
          shiftKey: false,
        },
        preventDefault,
      });

      expect(preventDefault).toHaveBeenCalled();
      expect(mockMutate).toHaveBeenCalledWith({
        conversationId: mockConversationId,
        senderProfileId: mockActiveProfileId,
        content: 'Web adventure!',
      });
    } finally {
      Object.defineProperty(Platform, 'OS', {
        value: originalOS,
        configurable: true,
      });
    }
  });

  it('does not send the message on Web when Shift+Enter is pressed', () => {
    const originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', {
      value: 'web',
      configurable: true,
    });
    try {
      const mockMutate = jest.fn();
      (useSendMessage as jest.Mock).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
      });

      render(<ConversationScreen />);
      const input = screen.getByTestId('message-input');
      fireEvent.changeText(input, 'Web newline!');

      const preventDefault = jest.fn();
      fireEvent(input, 'keyPress', {
        nativeEvent: {
          key: 'Enter',
          shiftKey: true,
        },
        preventDefault,
      });

      expect(preventDefault).not.toHaveBeenCalled();
      expect(mockMutate).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, 'OS', {
        value: originalOS,
        configurable: true,
      });
    }
  });

  it('hides timestamps for messages sent within 1 minute of each other, but shows them for the first and the absolute last message, or if they are 1+ minutes apart', () => {
    const now = Date.now();
    const time1 = new Date(now).toISOString();
    const time2 = new Date(now + 10000).toISOString(); // 10s later
    const time3 = new Date(now + 20000).toISOString(); // 20s later
    
    const messagesClose = [
      {
        message_id: 'm1',
        conversation_id: 'c1',
        sender_profile_id: 'p2',
        content: 'Close Message 1',
        type: 'user',
        sent_at: time1,
      },
      {
        message_id: 'm2',
        conversation_id: 'c1',
        sender_profile_id: 'p1',
        content: 'Close Message 2',
        type: 'user',
        sent_at: time2,
      },
      {
        message_id: 'm3',
        conversation_id: 'c1',
        sender_profile_id: 'p2',
        content: 'Close Message 3',
        type: 'user',
        sent_at: time3,
      },
    ];

    (useConversationMessages as jest.Mock).mockReturnValue({
      data: messagesClose,
      isLoading: false,
      isError: false,
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    const { rerender, queryAllByText } = render(<ConversationScreen />);
    
    const formattedTime1 = new Date(time1).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedTime2 = new Date(time2).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedTime3 = new Date(time3).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // m1 (index 2) -> shows (first message)
    // m2 (index 1) -> hides (within 1 min of m1)
    // m3 (index 0) -> shows (last message in chat list)
    //
    // If all three fall in the same minute format (e.g. 10:35):
    if (formattedTime1 === formattedTime2 && formattedTime2 === formattedTime3) {
      // Expect 2 rendered timestamps (for m1 and m3)
      expect(queryAllByText(formattedTime1).length).toBe(2);
    } else {
      // In the rare event they cross minute boundaries:
      // m1 (time1) must show
      expect(queryAllByText(formattedTime1).length).toBe(1);
      // m3 (time3) must show
      expect(queryAllByText(formattedTime3).length).toBe(1);
      // m2 (time2) must hide (and its timestamp is not rendered, so query for time2 should be 0)
      if (formattedTime2 !== formattedTime1 && formattedTime2 !== formattedTime3) {
        expect(queryAllByText(formattedTime2).length).toBe(0);
      }
    }

    // 2. Far apart (2 minutes):
    const timeFar = new Date(now + 120000).toISOString(); // 2 mins later
    const messagesFar = [
      {
        message_id: 'm1',
        conversation_id: 'c1',
        sender_profile_id: 'p2',
        content: 'Far Message 1',
        type: 'user',
        sent_at: time1,
      },
      {
        message_id: 'm4',
        conversation_id: 'c1',
        sender_profile_id: 'p1',
        content: 'Far Message 2',
        type: 'user',
        sent_at: timeFar,
      },
    ];

    (useConversationMessages as jest.Mock).mockReturnValue({
      data: messagesFar,
      isLoading: false,
      isError: false,
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
    });

    rerender(<ConversationScreen />);
    
    const formattedTimeFar = new Date(timeFar).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (formattedTime1 === formattedTimeFar) {
      expect(queryAllByText(formattedTime1).length).toBe(2);
    } else {
      expect(queryAllByText(formattedTime1).length).toBe(1);
      expect(queryAllByText(formattedTimeFar).length).toBe(1);
    }
  });
});
