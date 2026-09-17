import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  Pressable, 
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
import { useInvolvedMatches, useConversationMessages, useSendMessage, useRollDice, useTypingIndicator, useCreateConversation, useConversationDetails } from '../../hooks/useMessages';
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
import RichTextInput, { RichTextInputRef } from '../../components/RichTextInput';
import { parseMessageContent } from '../../lib/messageParser';

const INPUT_BAR_HEIGHT = MESSAGES.INPUT_BAR_HEIGHT + 60; // Adjust for 100px static editor height
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

// Map newly created conversation IDs to their participant profile IDs globally
// to prevent details loading resets when the screen unmounts/remounts during route replacement.
const globalCreatedConvoProfileMap: Record<string, string> = {};

function ConversationScreenInner() {
  const { id: rawId, equippedDie: equippedDieParam } = useLocalSearchParams<{ id: string; equippedDie?: string }>();
  const { activeProfileId } = useProfileContext();
  const queryClient = useQueryClient();

  // Detect pending (not-yet-created) conversations from the new_ route prefix
  const isNewConversation = rawId?.startsWith('new_') ?? false;
  const pendingOtherProfileId = isNewConversation ? rawId.slice(4) : undefined;
  // Track the real conversation ID — starts as the route param for existing
  // conversations, or undefined for new ones until the first message is sent.
  const [resolvedConversationId, setResolvedConversationId] = useState<string | undefined>(
    isNewConversation ? undefined : rawId
  );
  const conversationId = resolvedConversationId;

  // Track if this screen session was initialized as a temporary conversation
  const wasInitializedAsNewRef = useRef(isNewConversation);

  // Cache resolved profile name and image to avoid fallback flickers during transitions
  const lastProfileNameRef = useRef<string>('Traveler');
  const lastProfileImageRef = useRef<string | undefined>(undefined);

  // Reset resolvedConversationId and wasInitializedAsNewRef if rawId changes (due to back-and-forth navigation)
  useEffect(() => {
    if (rawId !== resolvedConversationId) {
      setResolvedConversationId(isNewConversation ? undefined : rawId);
      wasInitializedAsNewRef.current = isNewConversation;
    }
  }, [rawId, isNewConversation, resolvedConversationId]);
  const sessionStartTimestampRef = useRef<string>(new Date().toISOString());
  const [messageText, setMessageText] = useState('');
  const [equippedDie, setEquippedDie] = useState<string | null>(null);
  const [rollingDie, setRollingDie] = useState<string | null>(null);
  const [diceResultValue, setDiceResultValue] = useState<number | null>(null);
  const [rollKey, setRollKey] = useState(0);
  // true while the 3D animation is actively playing; false once it settles.
  // The die stays visible (rollingDie !== null) even after the animation ends.
  const [isAnimating, setIsAnimating] = useState(false);
  const richInputRef = useRef<RichTextInputRef>(null);
  const [isNarratingActive, setIsNarratingActive] = useState(false);
  // Guard: after clicking the Narrate button, ignore bridge-initiated state
  // changes for a short period so the WebView's intermediate italic state
  // oscillations don't flicker the button.
  const narrateGuardRef = useRef(false);

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
  const conversation = useConversationDetails(conversationId, activeProfileId);
  
  // If we are on a temporary route but the conversation already exists in our inbox cache,
  // resolve it immediately and transition to the active conversation to load messages.
  useEffect(() => {
    if (isNewConversation && pendingOtherProfileId && inbox.length > 0) {
      const existing = inbox.find(c => c.other_profile_id === pendingOtherProfileId);
      if (existing) {
        setResolvedConversationId(existing.id);
        router.replace(`/messages/${existing.id}`);
      }
    }
  }, [isNewConversation, pendingOtherProfileId, inbox, router]);
  
  // Find other profile ID
  const otherProfileId = isNewConversation
    ? pendingOtherProfileId
    : conversation?.other_profile_id || (rawId ? globalCreatedConvoProfileMap[rawId] : undefined);

  // Sync details cache reset to the actual target participant ID
  const [lastOtherProfileId, setLastOtherProfileId] = useState(otherProfileId);
  if (otherProfileId && otherProfileId !== lastOtherProfileId) {
    setLastOtherProfileId(otherProfileId);
    lastProfileNameRef.current = 'Traveler';
    lastProfileImageRef.current = undefined;
  }

  // Query the profile directly using our useProfile hook (safest fallback!)
  const { data: fetchedProfile, isLoading: isLoadingFetchedProfile } = useProfile(otherProfileId);
  const { data: activeProfile } = useProfile(activeProfileId);
  const activeAvatar = activeProfile?.image_urls?.[0];

  // Resolve otherProfile dynamically across all active caches (inbox, matches, fallback query)
  const otherProfile = conversation?.otherProfile ||
    (otherProfileId ? newMatches.find(m => m.otherProfile?.profile_id === otherProfileId)?.otherProfile : null) ||
    (otherProfileId ? inbox.find(c => c.other_profile_id === otherProfileId)?.otherProfile : null) ||
    fetchedProfile ||
    null;

  if (otherProfile) {
    lastProfileNameRef.current = otherProfile.display_name || 'Traveler';
    lastProfileImageRef.current = otherProfile.image_urls?.[0];
  }

  const isGroupConversation = conversation?.type === 'group' || (conversation?.participant_ids && conversation.participant_ids.length > 2);

  // Resolve profiles for all participants in group conversations
  const groupProfiles = useMemo(() => {
    if (conversation?.participantProfiles && conversation.participantProfiles.length > 0) {
      return conversation.participantProfiles;
    }
    return otherProfile ? [otherProfile] : [];
  }, [conversation?.participantProfiles, otherProfile]);

  const displayName = otherProfile?.display_name || lastProfileNameRef.current;
  const displayImage = otherProfile?.image_urls?.[0] || lastProfileImageRef.current;

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

      // Pre-seed the messages query cache so the subsequent optimistic updates
      // find a target and render the optimistic message instantly without a loading flash
      queryClient.setQueryData(['messages', newId, activeProfileId], {
        pages: [{ messages: [], has_more: false }],
        pageParams: [undefined]
      });

      globalCreatedConvoProfileMap[newId] = pendingOtherProfileId!;
      setResolvedConversationId(newId);
      // Replace the temporary route with the real conversation ID
      router.replace(`/messages/${newId}`);
      return newId;
    })();

    creatingConversationRef.current = promise;
    return promise;
  }, [resolvedConversationId, activeProfileId, pendingOtherProfileId, createConversation, queryClient]);

  // Handle equipped die coming back from the inventory screen
  useEffect(() => {
    if (equippedDieParam) {
      setEquippedDie(equippedDieParam);
    }
  }, [equippedDieParam]);

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
    const rawText = (await richInputRef.current?.getText())?.trim() || '';
    if (!rawText || !activeProfileId) return;

    // Get structured blocks directly from the editor's HTML
    const blocks = (await richInputRef.current?.getBlocks()) || [];

    richInputRef.current?.clear();
    setMessageText('');

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
          content: JSON.stringify(blocks),
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
      richInputRef.current?.restore(rawText);
      setMessageText(rawText);
      console.error('Failed to send message:', err);
    }
  }, [activeProfileId, ensureConversation, sendMessageAsync]);

  const handleNarrationChange = useCallback((isNarrating: boolean) => {
    // During the guard window (after a button press), ignore bridge changes
    if (narrateGuardRef.current) return;
    setIsNarratingActive(isNarrating);
  }, []);

  const handleFormatText = useCallback(() => {
    narrateGuardRef.current = true;
    const result = richInputRef.current?.toggleNarration(isNarratingActive);
    setIsNarratingActive(result ?? false);
    // Keep the guard up for 1 second while the WebView settles
    setTimeout(() => { narrateGuardRef.current = false; }, 1000);
  }, [isNarratingActive]);

  const handleTextChange = useCallback((text: string) => {
    setMessageText(text);
    onTextChange(text);
  }, [onTextChange]);

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

    // Expand user messages with JSON array content into separate display items
    // so narration blocks render as centered event pills and message blocks as chat bubbles
    const expanded: typeof messages = [];
    for (const msg of visible) {
      if (msg.type === 'user' && msg.content.startsWith('[')) {
        const blocks = parseMessageContent(msg.content);
        if (blocks.length > 1) {
          blocks.forEach((block, i) => {
            if (block.type === 'narration') {
              expanded.push({
                ...msg,
                message_id: `${msg.message_id}-block-${i}`,
                content: block.content,
                type: 'event',
                metadata: {
                  event_type: 'narration',
                  initiated_by: msg.sender_profile_id,
                },
              });
            } else {
              expanded.push({
                ...msg,
                message_id: `${msg.message_id}-block-${i}`,
                content: block.content,
              });
            }
          });
          continue;
        }
      }
      expanded.push(msg);
    }

    return expanded.slice().reverse();
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

  // Render the conversation screen immediately to avoid full-screen flashes.
  // Profile details and avatars will load and populate in-place.
  const isLoadingProfileInfo = false;

  return (
    <View style={styles.container}>
      <Stack.Screen 
        options={{
          headerShown: true,
          headerTitle: isGroupConversation && conversation?.name ? conversation.name : '',
          headerLeft: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable 
                onPress={() => router.replace('/(tabs)/messages')} 
                style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]} 
                testID="back-button"
              >
                <Ionicons name="chevron-back" size={24} color={Colors.onSurface} />
              </Pressable>
              {isGroupConversation ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 4 }} testID="header-group-avatars">
                  {groupProfiles.map((prof, idx) => {
                    const img = prof.image_urls?.[0];
                    return (
                      <Pressable
                        key={prof.profile_id || idx}
                        onPress={() => {
                          if (prof.profile_id) {
                            router.push({
                              pathname: '/profiles/preview',
                              params: { id: prof.profile_id }
                            } as any);
                          }
                        }}
                        style={({ pressed }) => [
                          { marginLeft: idx > 0 ? 4 : 0 },
                          pressed && { opacity: 0.7 }
                        ]}
                        testID={`header-group-avatar-${prof.profile_id}`}
                      >
                        {img ? (
                          <Image source={{ uri: img }} style={styles.headerAvatar} />
                        ) : (
                          <View style={[styles.headerAvatar, { justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.surfaceContainerHigh }]}>
                            <Ionicons name="person" size={18} color={Colors.outline} />
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Pressable
                  onPress={() => {
                    if (otherProfile?.profile_id) {
                      router.push({
                        pathname: '/profiles/preview',
                        params: { id: otherProfile.profile_id }
                      } as any);
                    }
                  }}
                  style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                  testID="header-profile-button"
                >
                  {displayImage ? (
                    <Image source={{ uri: displayImage }} style={styles.headerAvatar} />
                  ) : (
                    <View style={[styles.headerAvatar, { justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.surfaceContainerHigh }]}>
                      <Ionicons name="person" size={18} color={Colors.outline} />
                    </View>
                  )}
                </Pressable>
              )}
            </View>
          ),
          headerStyle: { backgroundColor: Colors.surface },
          headerShadowVisible: false,
        }} 
      />

      {isLoadingMessages && messages.length === 0 && !wasInitializedAsNewRef.current ? (
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
            const senderProfile = !isMe && isGroupConversation && item.sender_profile_id 
              ? groupProfiles.find(p => p.profile_id === item.sender_profile_id)
              : undefined;

            return (
              <ContainerView {...enteringProps} style={[styles.messageBubbleContainer, isMe ? styles.myMessageContainer : styles.theirMessageContainer]}>
                {!isMe && isGroupConversation && (
                  <Text style={styles.senderName}>{senderProfile?.display_name || 'Traveler'}</Text>
                )}
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
            onMouseDown={(e: any) => e.preventDefault()}
            style={[
              styles.modeTab,
              isNarratingActive && styles.modeTabActive,
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

          <Pressable
            onPress={() => {
              router.push({
                pathname: '/inventory',
                params: {
                  conversationId,
                  profileId: activeProfileId,
                },
              } as any);
            }}
            style={({ pressed }) => [
              styles.modeTab,
              pressed && { opacity: 0.8 },
            ]}
            testID="inventory-toggle-button"
          >
            <Ionicons
              name="bag-handle-outline"
              size={14}
              color={Colors.outline}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.modeTabText}>
              Inventory
            </Text>
          </Pressable>
        </View>

        <View style={styles.inputContainer}>
          <RichTextInput
            ref={richInputRef}
            placeholder="Compose a missive..."
            maxLength={MESSAGES.MAX_MESSAGE_LENGTH}
            onChangeText={handleTextChange}
            onSubmit={handleSend}
            onNarrationChange={handleNarrationChange}
            testID="message-input"
          />
          <View style={styles.sendControlsContainer}>
            <Pressable
              onPress={() => {
                if (activeProfileId) {
                  router.push({
                    pathname: '/profiles/preview',
                    params: { id: activeProfileId }
                  } as any);
                }
              }}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              testID="sender-profile-button"
            >
              {activeAvatar ? (
                <Image source={{ uri: activeAvatar }} style={styles.senderAvatar} />
              ) : (
                <View style={[styles.senderAvatar, { justifyContent: 'center', alignItems: 'center' }]}>
                  <Ionicons name="person" size={16} color={Colors.outline} />
                </View>
              )}
            </Pressable>
            <Pressable 
              style={({ pressed }) => [
                styles.sendButton, 
                pressed && { opacity: 0.7 }
              ]} 
              onPress={handleSend}
              testID="send-button"
            >
              <Ionicons 
                name="send" 
                size={22} 
                color={messageText !== '' ? Colors.primaryFixed : Colors.outline} 
              />
            </Pressable>
          </View>
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

