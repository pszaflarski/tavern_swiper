import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  TextInput, 
  Pressable, 
  Platform, 
  Image,
  ActivityIndicator,
  PanResponder,
  useWindowDimensions,
  Animated as RNAnimated,
} from 'react-native';
import { useLocalSearchParams, router, Stack, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '../../theme';
import { useProfileContext } from '../../context/ProfileContext';
import { useInvolvedMatches, useConversationMessages, useSendMessage, useRollDice, useTypingIndicator, useCreateConversation } from '../../hooks/useMessages';
import { useProfile } from '../../hooks/useProfiles';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, interpolate, Extrapolate, FadeInDown } from 'react-native-reanimated';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import DiceLoadingScreen from '../../components/DiceLoadingScreen';
import DiceOverlay from '../../components/DiceOverlay';
import { MESSAGES } from '../../constants';
import { styles } from './styles';
import { parseMessageContent, shiftRanges, buildJSONFromRanges, parseTextToJSON, FormattingRange } from '../../lib/messageParser';

const INPUT_BAR_HEIGHT = MESSAGES.INPUT_BAR_HEIGHT;
const MODE_TOOLBAR_HEIGHT = 46;

/** Max sides per die type for local random rolls */
const DICE_SIDES: Record<string, number> = {
  d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20,
};

// Die type → image asset mapping for the equipped die circle
const DICE_IMAGES: Record<string, any> = {
  d4:  require('../../assets/dice/triangle/4.png'),
  d6:  require('../../assets/dice/square/6.png'),
  d8:  require('../../assets/dice/triangle/8.png'),
  d12: require('../../assets/dice/pentagon/12.png'),
  d20: require('../../assets/dice/triangle/20.png'),
};

// ---------------------------------------------------------------------------
// Animated typing dots — three dots that pulse in sequence
// ---------------------------------------------------------------------------
function TypingBubble() {
  const dot1 = useRef(new RNAnimated.Value(0)).current;
  const dot2 = useRef(new RNAnimated.Value(0)).current;
  const dot3 = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const animate = (dot: RNAnimated.Value, delay: number) =>
      RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.delay(delay),
          RNAnimated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          RNAnimated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          RNAnimated.delay(600 - delay),
        ])
      );

    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 200);
    const a3 = animate(dot3, 400);
    a1.start(); a2.start(); a3.start();

    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [dot1, dot2, dot3]);

  const dotStyle = (anim: RNAnimated.Value) => ({
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }],
  });

  return (
    <View style={styles.typingContainer} testID="typing-indicator">
      <View style={styles.typingBubble}>
        <RNAnimated.View style={[styles.typingDot, dotStyle(dot1)]} />
        <RNAnimated.View style={[styles.typingDot, dotStyle(dot2)]} />
        <RNAnimated.View style={[styles.typingDot, dotStyle(dot3)]} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Equipped die circle — freely draggable, tap to roll, drag off bottom to dismiss
// ---------------------------------------------------------------------------
const TAP_THRESHOLD = 10; // Max movement (px) to count as a tap

function EquippedDieCircle({ dieType, onRoll, onDismiss, screenHeight }: {
  dieType: string;
  onRoll: () => void;
  onDismiss: () => void;
  screenHeight: number;
}) {
  // Persistent position so drag sticks between renders
  const posRef = useRef({ x: 0, y: 0 });
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Keep callback refs in sync so the PanResponder (created once) always
  // invokes the latest versions instead of stale first-render closures.
  const onRollRef = useRef(onRoll);
  const onDismissRef = useRef(onDismiss);
  const screenHeightRef = useRef(screenHeight);
  useEffect(() => {
    onRollRef.current = onRoll;
    onDismissRef.current = onDismiss;
    screenHeightRef.current = screenHeight;
  });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gs) => {
        setPos({
          x: posRef.current.x + gs.dx,
          y: posRef.current.y + gs.dy,
        });
      },
      onPanResponderRelease: (_, gs) => {
        const totalMove = Math.abs(gs.dx) + Math.abs(gs.dy);

        if (totalMove < TAP_THRESHOLD) {
          // It was a tap — roll the die
          onRollRef.current();
          return;
        }

        // Persist the new position
        const newX = posRef.current.x + gs.dx;
        const newY = posRef.current.y + gs.dy;
        posRef.current = { x: newX, y: newY };

        // If released in the input bar zone (bottom ~80px of screen), unequip
        if (gs.moveY > screenHeightRef.current - 80) {
          onDismissRef.current();
        }
      },
    })
  ).current;

  return (
    <View
      style={[
        styles.equippedDieFloat,
        { transform: [{ translateX: pos.x }, { translateY: pos.y }] },
      ]}
      {...panResponder.panHandlers}
    >
      <View style={styles.equippedDieCircle} testID="equipped-die-roll-button">
        <Image
          source={DICE_IMAGES[dieType] || DICE_IMAGES['d6']}
          style={styles.equippedDieImage}
          resizeMode="contain"
        />
      </View>
      <Pressable
        onPress={onDismiss}
        style={({ pressed }) => [styles.equippedDieDismiss, pressed && { opacity: 0.5 }]}
        testID="equipped-die-dismiss"
      >
        <Ionicons name="close-circle" size={16} color={Colors.outline} />
      </Pressable>
    </View>
  );
}

function ConversationScreenInner() {
  const { id: rawId, equippedDie: equippedDieParam } = useLocalSearchParams<{ id: string; equippedDie?: string }>();
  const { activeProfileId } = useProfileContext();

  // Detect pending (not-yet-created) conversations from the new_ route prefix
  const isNewConversation = rawId?.startsWith('new_') ?? false;
  const pendingOtherProfileId = isNewConversation ? rawId.slice(4) : undefined;
  // Track the real conversation ID — starts as the route param for existing
  // conversations, or undefined for new ones until the first message is sent.
  const [resolvedConversationId, setResolvedConversationId] = useState<string | undefined>(
    isNewConversation ? undefined : rawId
  );
  const conversationId = resolvedConversationId;
  const sessionStartTimestampRef = useRef<string>(new Date().toISOString());
  const [messageText, setMessageText] = useState('');
  const [equippedDie, setEquippedDie] = useState<string | null>(null);
  const [rollingDie, setRollingDie] = useState<string | null>(null);
  const [diceResultValue, setDiceResultValue] = useState<number | null>(null);
  const [rollKey, setRollKey] = useState(0);
  // true while the 3D animation is actively playing; false once it settles.
  // The die stays visible (rollingDie !== null) even after the animation ends.
  const [isAnimating, setIsAnimating] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [inputScrollY, setInputScrollY] = useState(0);

  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [formattingRanges, setFormattingRanges] = useState<FormattingRange[]>([]);
  const isTypingRef = useRef(false);
  const [isNarratingAtCursor, setIsNarratingAtCursor] = useState(false);

  // Compute active highlight state for Narrate formatting (word processor behavior)
  const isNarratingActive = useMemo(() => {
    const { start, end } = selection;
    if (start !== end) {
      // For selection range, active if selection is completely inside a narration range
      return formattingRanges.some(r => r.start <= start && end <= r.end);
    }
    // For cursor point, active if strictly inside any narration range
    if (formattingRanges.some(r => r.start < start && start < r.end)) {
      return true;
    }
    // Otherwise, matches the toggled state at cursor
    return isNarratingAtCursor;
  }, [selection, formattingRanges, isNarratingAtCursor]);

  const handleSelectionChange = (start: number, end: number) => {
    // If the coordinates didn't change, do nothing (prevents focus events from resetting states)
    if (start === selection.start && end === selection.end) {
      return;
    }

    setSelection({ start, end });

    // If selection changed due to typing, preserve the active typing mode state
    if (isTypingRef.current) {
      isTypingRef.current = false;
      return;
    }

    // If selection changed due to tap/cursor move:
    if (start === end) {
      // Default to active if cursor is inside or at the boundary of a narration range
      const isAtOrInside = formattingRanges.some(r => r.start <= start && start <= r.end);
      setIsNarratingAtCursor(isAtOrInside);
    } else {
      setIsNarratingAtCursor(false);
    }
  };

  // --- Dice animation queue ---
  // Tracks dice_roll event message_ids we've already enqueued so we never
  // double-add when the messages array reference changes.
  const processedDiceIdsRef = useRef<Set<string>>(new Set());
  // Watermark: the sent_at of the newest message when the conversation first
  // loaded. Only dice_roll events AFTER this timestamp get animated.
  // Resets on component remount (i.e. opening a different conversation).
  const diceWatermarkRef = useRef<string | null>(null);
  const [diceQueue, setDiceQueue] = useState<Array<{
    messageId: string;
    sentAt: string;
    dieType: string;
    value: number;
  }>>([]); 

  const flatListRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();

  // The methodology we're using:
  // 1. react-native-keyboard-controller's useReanimatedKeyboardAnimation for native frame-synced tracking.
  // 2. Animated.View for the input bar with absolute positioning to avoid layout thrashing.
  // 3. A dynamic spacer in the FlatList footer that perfectly mirrors the keyboard + input bar height.
  // This is recorded as the gold standard for this repo in docs/patterns/keyboard-handling.md
  
  // Native keyboard animation hook — gives us a smooth, frame-synced height value
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const { height: screenHeight } = useWindowDimensions();

  // Get conversation info (other profile details etc.)
  const { inbox, newMatches, isLoading: isLoadingInbox } = useInvolvedMatches(activeProfileId);
  const conversation = conversationId ? inbox.find(c => c.id === conversationId) : undefined;
  
  // Find other profile ID
  const otherProfileId = isNewConversation 
    ? pendingOtherProfileId 
    : conversation?.other_profile_id;

  // Query the profile directly using our useProfile hook (safest fallback!)
  const { data: fetchedProfile, isLoading: isLoadingFetchedProfile } = useProfile(otherProfileId);

  // For pending conversations, resolve the other profile from the matches list
  const otherProfile = (isNewConversation
    ? newMatches.find(m => m.otherProfile?.profile_id === pendingOtherProfileId)?.otherProfile ?? null
    : conversation?.otherProfile) || fetchedProfile || null;

  // Get messages
  const {
    data: messages = [],
    isLoading: isLoadingMessages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    typing,
  } = useConversationMessages(
    conversationId,
    activeProfileId,
  );

  // Typing indicator
  const { isOtherTyping, onTextChange } = useTypingIndicator(
    conversationId,
    activeProfileId,
    typing,
    messages,
  );
  const { mutateAsync: sendMessageAsync } = useSendMessage();
  const { mutateAsync: rollDice } = useRollDice();
  const { mutateAsync: createConversation } = useCreateConversation();

  // Ref to guard against double-creation during concurrent sends
  const creatingConversationRef = useRef<Promise<string> | null>(null);

  /**
   * Lazily create the conversation on the backend. Returns the real
   * conversation_id. Safe to call multiple times — only the first call
   * actually hits the API; subsequent calls await the same promise.
   */
  const ensureConversation = useCallback(async (): Promise<string> => {
    // Already resolved
    if (resolvedConversationId) return resolvedConversationId;

    // Already in-flight — await the same promise
    if (creatingConversationRef.current) return creatingConversationRef.current;

    if (!activeProfileId || !pendingOtherProfileId) {
      throw new Error('Cannot create conversation: missing profile IDs');
    }

    const promise = (async () => {
      const data = await createConversation({
        participants: [activeProfileId, pendingOtherProfileId],
      });
      const newId = data.conversation_id;
      setResolvedConversationId(newId);
      // Replace the temporary route with the real conversation ID
      router.replace(`/messages/${newId}`);
      return newId;
    })();

    creatingConversationRef.current = promise;
    return promise;
  }, [resolvedConversationId, activeProfileId, pendingOtherProfileId, createConversation]);

  // Handle equipped die coming back from the inventory screen
  useEffect(() => {
    if (equippedDieParam) {
      setEquippedDie(equippedDieParam);
    }
  }, [equippedDieParam]);

  const queryClient = useQueryClient();

  // Roll the equipped die — API only, no animation
  const handleRollEquipped = async () => {
    if (!equippedDie || !activeProfileId) return;
    try {
      const realConvId = await ensureConversation();
      const result = await rollDice({
        dieType: equippedDie,
        conversationId: realConvId,
        profileId: activeProfileId,
      });
      console.log(`🎲 Dice roll posted: ${equippedDie} → ${result.result}`);
      // Invalidate messages so the event message appears in chat
      queryClient.invalidateQueries({ queryKey: ['messages', realConvId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      console.error('🎲 Dice roll failed:', err);
    }
  };

  // -----------------------------------------------------------------------
  // ENQUEUE: Scan messages for dice_roll events we haven't seen yet.
  // On first load, sets a watermark to the newest message's sent_at so
  // we only animate rolls that arrive AFTER the conversation was opened.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (messages.length === 0) return;

    // First load: capture the watermark and mark all existing dice_roll
    // message_ids as processed (so they never get enqueued).
    if (diceWatermarkRef.current === null) {
      const newest = messages[messages.length - 1];
      diceWatermarkRef.current = newest.sent_at;
      console.log(`🎲 Dice watermark set: ${diceWatermarkRef.current}`);
      // Pre-mark all existing dice_roll ids so they're never enqueued
      for (const msg of messages) {
        if (msg.type === 'event' && msg.metadata?.event_type === 'dice_roll') {
          processedDiceIdsRef.current.add(msg.message_id);
        }
      }
      return;
    }

    const newItems: Array<{ messageId: string; sentAt: string; dieType: string; value: number }> = [];

    for (const msg of messages) {
      if (
        msg.type === 'event' &&
        msg.metadata?.event_type === 'dice_roll' &&
        msg.sent_at > diceWatermarkRef.current! &&
        !processedDiceIdsRef.current.has(msg.message_id)
      ) {
        processedDiceIdsRef.current.add(msg.message_id);
        const meta = msg.metadata?.metadata;
        newItems.push({
          messageId: msg.message_id,
          sentAt: msg.sent_at,
          dieType: (meta?.item_name as string) || 'd6',
          value: (meta?.value as number) || Math.ceil(Math.random() * 6),
        });
      }
    }

    if (newItems.length > 0) {
      console.log(`🎲 Enqueuing ${newItems.length} dice roll(s):`, newItems.map(i => `${i.dieType}→${i.value}`).join(', '));
      setDiceQueue((q) => [...q, ...newItems]);
    }
  }, [messages]);

  // -----------------------------------------------------------------------
  // PROCESS: When the queue has items and no animation is actively playing,
  // pop the next item and trigger the 3D dice animation.
  // The die from a previous roll may still be visible — that's fine,
  // the new roll replaces it via rollKey remount.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (diceQueue.length === 0 || isAnimating) return;

    const next = diceQueue[0];
    console.log(`🎲 Processing queue: ${next.dieType} → ${next.value} (${diceQueue.length} remaining)`);
    setDiceResultValue(next.value);
    setRollingDie(next.dieType);
    setRollKey((k) => k + 1);
    setIsAnimating(true);
  }, [diceQueue, isAnimating]);

  // Invalidate conversations cache when exiting — the backend just marked
  // this conversation as read, so the inbox dots need to update.
  useEffect(() => {
    return () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    };
  }, [queryClient]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || !activeProfileId) return;

    const rawText = messageText.trim();
    // Parse the input into separate blocks
    const jsonStr = rawText.includes('<narrate>') 
      ? parseTextToJSON(rawText) 
      : buildJSONFromRanges(rawText, formattingRanges);
    const blocks = parseMessageContent(jsonStr);

    setMessageText('');
    setFormattingRanges([]);
    setIsNarratingAtCursor(false);

    try {
      const realConvId = await ensureConversation();

      const hasNarration = blocks.some(b => b.type === 'narration');
      const hasMessage = blocks.some(b => b.type === 'message');

      if (hasNarration && hasMessage) {
        // Mixed content: send as a single user message with JSON array content
        // so the bot sees one message and replies once
        await sendMessageAsync({
          conversationId: realConvId,
          senderProfileId: activeProfileId,
          content: jsonStr,
          type: 'user',
        });
      } else if (hasNarration) {
        // Pure narration: send as a single event (renders as centered pill)
        const narrationText = blocks.map(b => b.content).join(' ');
        await sendMessageAsync({
          conversationId: realConvId,
          senderProfileId: activeProfileId,
          content: narrationText,
          type: 'event',
          metadata: {
            event_type: 'narration',
            initiated_by: activeProfileId,
          }
        });
      } else {
        // Pure message: send as plain text
        await sendMessageAsync({
          conversationId: realConvId,
          senderProfileId: activeProfileId,
          content: rawText,
          type: 'user',
        });
      }
    } catch (err) {
      // Restore the message text so the user can retry
      setMessageText(rawText);
      console.error('Failed to send message:', err);
    }
  }, [messageText, formattingRanges, activeProfileId, ensureConversation, sendMessageAsync]);

  const addNarrationRange = (ranges: FormattingRange[], start: number, end: number): FormattingRange[] => {
    const newRange = { start, end, type: 'narration' as const };
    const all = [...ranges, newRange];
    all.sort((a, b) => a.start - b.start);
    
    const merged: FormattingRange[] = [];
    for (const r of all) {
      if (merged.length === 0) {
        merged.push(r);
      } else {
        const prev = merged[merged.length - 1];
        if (r.start <= prev.end) {
          prev.end = Math.max(prev.end, r.end);
        } else {
          merged.push(r);
        }
      }
    }
    return merged;
  };

  const handleFormatText = () => {
    const { start, end } = selection;
    if (start !== end) {
      // Selection range: toggle narration for selection
      setFormattingRanges((prev) => {
        // Is selection entirely narration?
        const isEntirelyNarration = prev.some(r => r.start <= start && end <= r.end);
        if (isEntirelyNarration) {
          // Remove narration from [start, end]
          const nextRanges: FormattingRange[] = [];
          for (const r of prev) {
            if (r.end <= start || r.start >= end) {
              nextRanges.push(r);
            } else {
              if (r.start < start) {
                nextRanges.push({ start: r.start, end: start, type: 'narration' });
              }
              if (r.end > end) {
                nextRanges.push({ start: end, end: r.end, type: 'narration' });
              }
            }
          }
          return nextRanges;
        } else {
          // Add narration for [start, end] and merge
          const all = [...prev, { start, end, type: 'narration' as const }];
          all.sort((a, b) => a.start - b.start);
          const merged: FormattingRange[] = [];
          for (const r of all) {
            if (merged.length === 0) {
              merged.push(r);
            } else {
              const last = merged[merged.length - 1];
              if (r.start <= last.end) {
                last.end = Math.max(last.end, r.end);
              } else {
                merged.push(r);
              }
            }
          }
          return merged;
        }
      });
    } else {
      // Cursor point:
      const i = start;
      const insideRange = formattingRanges.find(r => r.start < i && i < r.end);
      if (insideRange) {
        // Split the range
        setFormattingRanges((prev) => {
          const nextRanges: FormattingRange[] = [];
          for (const r of prev) {
            if (r.start < i && i < r.end) {
              nextRanges.push({ start: r.start, end: i, type: 'narration' });
              nextRanges.push({ start: i, end: r.end, type: 'narration' });
            } else {
              nextRanges.push(r);
            }
          }
          return nextRanges;
        });
        setIsNarratingAtCursor(false);
      } else {
        // Toggle the override state
        setIsNarratingAtCursor(!isNarratingActive);
      }
    }

    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleTextChange = (text: string) => {
    isTypingRef.current = true;
    const diff = text.length - messageText.length;
    const currentIsNarrating = isNarratingActive;

    let nextRanges = shiftRanges(formattingRanges, messageText, text, selection.start, selection.end, currentIsNarrating);

    if (diff > 0 && currentIsNarrating) {
      nextRanges = addNarrationRange(nextRanges, selection.start, selection.start + diff);
    }

    setFormattingRanges(nextRanges);
    setMessageText(text);
    onTextChange(text);
    setIsNarratingAtCursor(currentIsNarrating);
  };

  const renderInputWithFormatting = (text: string, ranges: FormattingRange[]) => {
    if (!text) return null;
    if (ranges.length === 0) {
      return <Text style={[styles.inputOverlayText, { color: Colors.onSurface }]}>{text}</Text>;
    }

    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;

    sorted.forEach((range, idx) => {
      if (range.start > lastIndex) {
        elements.push(
          <Text key={`msg-${idx}`} style={[styles.inputOverlayText, { color: Colors.onSurface }]}>
            {text.substring(lastIndex, range.start)}
          </Text>
        );
      }
      elements.push(
        <Text
          key={`narr-${idx}`}
          style={[styles.inputOverlayText, { fontStyle: 'italic', color: Colors.tertiaryFixedDim }]}
        >
          {text.substring(range.start, range.end)}
        </Text>
      );
      lastIndex = range.end;
    });

    if (lastIndex < text.length) {
      elements.push(
        <Text key="msg-end" style={[styles.inputOverlayText, { color: Colors.onSurface }]}>
          {text.substring(lastIndex)}
        </Text>
      );
    }

    return <Text>{elements}</Text>;
  };

  const renderMessageContent = (content: string, isMe: boolean) => {
    const blocks = parseMessageContent(content);
    
    return (
      <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.theirMessageText]}>
        {blocks.map((block, index) => {
          if (block.type === 'narration') {
            return (
              <Text
                key={index}
                style={[
                  styles.messageTextNarration,
                  isMe ? styles.myMessageTextNarration : styles.theirMessageTextNarration
                ]}
              >
                {block.content}
              </Text>
            );
          }
          return <Text key={index}>{block.content}</Text>;
        })}
      </Text>
    );
  };

  // Hide messages at or after the currently-animating dice_roll's sent_at.
  // This hides the roll event AND any follow-up messages (e.g. Lira's
  // commentary) so they don't spoil the result before the animation finishes.
  // Derived directly from the queue — no extra state needed.
  const hideMessagesCutoff = diceQueue.length > 0 ? diceQueue[0].sentAt : null;

  // We use an inverted FlatList — the standard pattern for chat UIs.
  // By inverting, the most recent message sits at the scroll origin (top of the
  // virtual list = bottom of the screen), so no scrollToEnd hacks are needed.
  // The data array is reversed so visual order stays chronological.
  const invertedMessages = useMemo(() => {
    const visible = hideMessagesCutoff
      ? messages.filter(m => m.sent_at < hideMessagesCutoff)
      : messages;
    return visible.slice().reverse();
  }, [messages, hideMessagesCutoff]);

  const navigation = useNavigation();

  // Hide the tab bar while on this screen to allow the chat bar to be the footer
  useEffect(() => {
    const parent = navigation.getParent();
    if (parent) {
      parent.setOptions({
        tabBarStyle: { display: 'none' },
      });
    }
    
    return () => {
      if (parent) {
        parent.setOptions({
          tabBarStyle: {
            backgroundColor: Colors.surfaceContainerLowest,
            borderTopColor: Colors.outlineVariant,
            display: 'flex', // Restore on exit
          },
        });
      }
    };
  }, [navigation]);

  // Animated style for the input bar — translates up with the keyboard.
  // Now that the Tab Bar is hidden, this bar sits at the very bottom.
  // We use paddingBottom to ensure absolute symmetry around the text box.
  const inputBarAnimatedStyle = useAnimatedStyle(() => {
    const bottomPadding = interpolate(
      Math.abs(keyboardHeight.value),
      [0, 100],
      [insets.bottom + Spacing[3], Spacing[3]], // Mirror the Spacing[3] top padding
      Extrapolate.CLAMP
    );

    return {
      transform: [{ translateY: keyboardHeight.value }],
      paddingBottom: bottomPadding,
    };
  });



  // Animated style for the FlatList spacer.
  // Precisely mirrors the footer's height for smooth scrolling.
  const listBottomSpacerStyle = useAnimatedStyle(() => ({
    height: INPUT_BAR_HEIGHT + insets.bottom + Math.abs(keyboardHeight.value) + Spacing[6] + MODE_TOOLBAR_HEIGHT,
  }));

  const isLoadingProfileInfo = isNewConversation
    ? (!otherProfile && (isLoadingInbox || isLoadingFetchedProfile))
    : (isLoadingInbox && !conversation);

  if (isLoadingProfileInfo) {
    return <DiceLoadingScreen />;
  }

  return (
    <View style={styles.container}>
      <Stack.Screen 
        options={{
          headerShown: true,
          headerTitle: '',
          headerLeft: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable 
                onPress={() => router.replace('/(tabs)/messages')} 
                style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]} 
                testID="back-button"
              >
                <Ionicons name="chevron-back" size={24} color={Colors.onSurface} />
              </Pressable>
              
              <Pressable
                onPress={() => {
                  if (otherProfile?.profile_id) {
                    router.push({
                      pathname: '/profiles/preview',
                      params: { id: otherProfile.profile_id }
                    } as any);
                  }
                }}
                style={({ pressed }) => [
                  styles.headerProfile,
                  pressed && { opacity: 0.7 }
                ]}
                testID="header-profile-button"
              >
                {otherProfile?.image_urls?.[0] ? (
                  <Image source={{ uri: otherProfile.image_urls[0] }} style={styles.headerAvatar} />
                ) : (
                  <View style={[styles.headerAvatar, { justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.surfaceContainerHigh }]}>
                    <Ionicons name="person" size={18} color={Colors.outline} />
                  </View>
                )}
                <View>
                  <Text style={styles.headerName}>{otherProfile?.display_name || 'Traveler'}</Text>
                  <Text style={styles.headerStatus}>Online in the tavern</Text>
                </View>
              </Pressable>
            </View>
          ),
          headerStyle: { backgroundColor: Colors.surface },
          headerShadowVisible: false,
        }} 
      />

      {isLoadingMessages && messages.length === 0 ? (
        <DiceLoadingScreen message="Reading the scrolls..." />
      ) : invertedMessages.length === 0 ? (
        <View style={[styles.emptyContainer]}>
          <Text style={styles.emptyText}>The air is thick with unspoken words.</Text>
          <Text style={styles.emptySubText}>Break the silence with a greeting.</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={invertedMessages}
          inverted
          keyExtractor={(item) => item.message_id}
          contentContainerStyle={[styles.messageList, { flexGrow: 1 }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          renderItem={({ item, index }) => {
            const nextItem = index > 0 ? invertedMessages[index - 1] : undefined;
            const showTimestamp = !nextItem || 
              nextItem.sender_profile_id !== item.sender_profile_id || 
              nextItem.type !== item.type ||
              Math.abs(new Date(nextItem.sent_at).getTime() - new Date(item.sent_at).getTime()) >= 60000;

            // Calculate total new messages currently in view to stagger animations
            let newMessagesCount = 0;
            for (let i = 0; i < invertedMessages.length; i++) {
              const msg = invertedMessages[i];
              const isMsgNew = msg.isOptimistic || (msg.sender_profile_id !== activeProfileId && msg.sent_at && msg.sent_at > sessionStartTimestampRef.current);
              if (isMsgNew) {
                newMessagesCount++;
              } else {
                break;
              }
            }

            const isMe = item.sender_profile_id === activeProfileId;
            const isNew = item.isOptimistic || (item.sender_profile_id !== activeProfileId && item.sent_at && item.sent_at > sessionStartTimestampRef.current);
            const ContainerView = isNew ? Animated.View : View;
            
            const batchIndex = newMessagesCount - 1 - index;
            const delayMs = isNew ? Math.max(0, batchIndex) * 250 : 0;
            const enteringProps = isNew ? { entering: FadeInDown.delay(delayMs).duration(300).springify().damping(15) } : {};

            // Event messages
            if (item.type === 'event') {
              // Narration events — centered italic pill
              if (item.metadata?.event_type === 'narration') {
                return (
                  <ContainerView {...enteringProps} style={styles.eventContainer}>
                    <View style={styles.eventBubble}>
                      <Text style={styles.eventText}>
                        {item.content}
                      </Text>
                    </View>
                    {item.isOptimistic ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                        <ActivityIndicator size="small" color={Colors.outline} style={{ marginRight: 4 }} />
                        <Text style={styles.timestamp}>sending...</Text>
                      </View>
                    ) : (
                      showTimestamp && (
                        <Text style={styles.timestamp}>
                          {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      )
                    )}
                  </ContainerView>
                );
              }

              // Other events — centered gold pill (dice rolls, etc.)
              // Parse dice roll pattern: "{name} rolled a {number} on a {diceType}"
              const diceMatch = item.content.match(/^(.+?) rolled a (\d+) on a (d\d+)$/);

              return (
                <ContainerView {...enteringProps} style={styles.eventContainer}>
                  <View style={styles.eventBubble}>
                    {diceMatch ? (
                      <Text style={styles.eventText}>
                        <Text style={styles.eventHighlight}>{diceMatch[1]}</Text>
                        {' rolled a '}
                        <Text style={styles.eventHighlight}>{diceMatch[2]}</Text>
                        {' on a '}
                        <Text style={styles.eventHighlight}>{diceMatch[3]}</Text>
                      </Text>
                    ) : (
                      <Text style={styles.eventText}>{item.content}</Text>
                    )}
                  </View>
                  {item.isOptimistic ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                      <ActivityIndicator size="small" color={Colors.outline} style={{ marginRight: 4 }} />
                      <Text style={styles.timestamp}>sending...</Text>
                    </View>
                  ) : (
                    showTimestamp && (
                      <Text style={styles.timestamp}>
                        {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    )
                  )}
                </ContainerView>
              );
            }


            // System messages — centered muted pill
            if (item.type === 'system') {
              return (
                <ContainerView {...enteringProps} style={styles.systemContainer}>
                  <View style={styles.systemBubble}>
                    <Text style={styles.systemText}>{item.content}</Text>
                  </View>
                  {showTimestamp && (
                    <Text style={styles.timestamp}>
                      {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  )}
                </ContainerView>
              );
            }

            // User messages — left/right aligned bubbles
            return (
              <ContainerView {...enteringProps} style={[styles.messageBubbleContainer, isMe ? styles.myMessageContainer : styles.theirMessageContainer]}>
                <View style={[
                  styles.messageBubble, 
                  isMe ? styles.myMessageBubble : styles.theirMessageBubble
                ]}>
                  {renderMessageContent(item.content, isMe)}
                </View>
                {item.isOptimistic ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                    <ActivityIndicator size="small" color={Colors.outline} style={{ marginRight: 4 }} />
                    <Text style={styles.timestamp}>sending...</Text>
                  </View>
                ) : (
                  showTimestamp && (
                    <Text style={styles.timestamp}>
                      {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  )
                )}
              </ContainerView>
            );
          }}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={
            <>
              {isOtherTyping && <TypingBubble />}
              <Animated.View style={listBottomSpacerStyle} />
            </>
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.loadingMoreText}>Unrolling older scrolls...</Text>
              </View>
            ) : null
          }
        />
      )}

      <Animated.View style={[styles.inputWrapper, inputBarAnimatedStyle]}>
        <View style={styles.modeToolbar} testID="mode-toolbar">
          <Pressable
            onPress={handleFormatText}
            style={({ pressed }) => [
              styles.modeTab,
              isNarratingActive && styles.modeTabActive,
              pressed && { opacity: 0.8 },
            ]}
            testID="mode-narrate-button"
          >
            <Ionicons
              name="book"
              size={14}
              color={isNarratingActive ? Colors.tertiaryFixedDim : Colors.outline}
              style={{ marginRight: 6 }}
            />
            <Text style={[
              styles.modeTabText,
              isNarratingActive && styles.modeTabTextActive
            ]}>
              Narrate
            </Text>
          </Pressable>
        </View>

        <View style={styles.inputContainer}>
          <View style={styles.inputWrapperContainer}>
            {/* Formatted overlay — shows the styled text, moves with TextInput scroll */}
            <View style={styles.inputOverlayContainer} pointerEvents="none">
              <View style={[styles.inputOverlayInner, { transform: [{ translateY: -inputScrollY }] }]}>  
                {renderInputWithFormatting(messageText, formattingRanges)}
              </View>
            </View>

            {/* Real TextInput — text is transparent, only the caret is visible */}
            <TextInput
              ref={inputRef}
              style={[
                styles.inputReal,
                isNarratingActive && { fontStyle: 'italic' as const },
                Platform.OS === 'web' && { caretColor: isNarratingActive ? Colors.tertiaryFixedDim : Colors.primary } as any,
              ]}
              placeholder={messageText ? '' : 'Compose a missive...'}
              placeholderTextColor={Colors.outline}
              value={messageText}
              onChangeText={handleTextChange}
              onSelectionChange={(e) => {
                handleSelectionChange(e.nativeEvent.selection.start, e.nativeEvent.selection.end);
              }}
              onScroll={(e: any) => {
                const y = e.nativeEvent?.contentOffset?.y ?? e.target?.scrollTop ?? 0;
                setInputScrollY(y);
              }}
              selectionColor={Colors.primary}
              multiline
              maxLength={MESSAGES.MAX_MESSAGE_LENGTH}
              testID="message-input"
              onKeyPress={(e: any) => {
                if (Platform.OS === 'web') {
                  if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }
              }}
            />
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.diceToggle,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => {
              router.push({
                pathname: '/inventory',
                params: {
                  conversationId,
                  profileId: activeProfileId,
                },
              } as any);
            }}
            testID="inventory-toggle-button"
          >
            <Ionicons
              name="bag-handle-outline"
              size={22}
              color={Colors.outline}
            />
          </Pressable>
          <Pressable 
            style={({ pressed }) => [
              styles.sendButton, 
              !messageText.trim() && styles.sendButtonDisabled,
              pressed && { opacity: 0.7 }
            ]} 
            onPress={handleSend}
            disabled={!messageText.trim()}
            testID="send-button"
          >
            <Ionicons name="send" size={20} color={Colors.onPrimary} />
          </Pressable>
        </View>
      </Animated.View>

      {/* Equipped die circle — floats over everything, freely draggable */}
      {equippedDie && (
        <EquippedDieCircle
          dieType={equippedDie}
          onRoll={handleRollEquipped}
          onDismiss={() => {
            setEquippedDie(null);
            // Also dismiss the dice overlay if it's showing
            if (rollingDie) {
              setRollingDie(null);
              setDiceResultValue(null);
              setIsAnimating(false);
              setDiceQueue([]);
            }
          }}
          screenHeight={screenHeight}
        />
      )}

      {/* Dice overlay — purely visual, no backend interaction */}
      <DiceOverlay
        visible={rollingDie !== null}
        dieType={(rollingDie ?? 'd6') as 'd4' | 'd6' | 'd8' | 'd12' | 'd20'}
        rollKey={rollKey}
        desiredValue={diceResultValue ?? undefined}
        onResult={(value: number) => {
          console.log(`🎲 Animation complete — ${rollingDie}: ${value}`);
          // Dequeue the completed item. The die stays visible (rollingDie
          // remains set) until dismissed or replaced by the next roll.
          setDiceQueue((q) => q.slice(1));
          setIsAnimating(false);
        }}
        onDismiss={() => {
          setRollingDie(null);
          setDiceResultValue(null);
          setIsAnimating(false);
          setDiceQueue([]);
        }}
      />
    </View>
  );
}

export default function ConversationScreen() {
  return (
    <ScreenErrorBoundary fallbackMessage="The raven lost your conversation scroll.">
      <ConversationScreenInner />
    </ScreenErrorBoundary>
  );
}

