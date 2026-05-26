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
} from 'react-native';
import { useLocalSearchParams, router, Stack, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../../theme';
import { useProfileContext } from '../../context/ProfileContext';
import { useInvolvedMatches, useConversationMessages, useSendMessage, useRollDice } from '../../hooks/useMessages';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, interpolate, Extrapolate } from 'react-native-reanimated';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import DiceOverlay from '../../components/DiceOverlay';
import { MESSAGES } from '../../constants';
import { styles } from './styles';

const INPUT_BAR_HEIGHT = MESSAGES.INPUT_BAR_HEIGHT;

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
  const { id: conversationId, equippedDie: equippedDieParam } = useLocalSearchParams<{ id: string; equippedDie?: string }>();
  const { activeProfileId } = useProfileContext();
  const [messageText, setMessageText] = useState('');
  const [equippedDie, setEquippedDie] = useState<string | null>(null);
  const [rollingDie, setRollingDie] = useState<string | null>(null);
  const [diceResultValue, setDiceResultValue] = useState<number | null>(null);
  const [rollKey, setRollKey] = useState(0);
  // true while the 3D animation is actively playing; false once it settles.
  // The die stays visible (rollingDie !== null) even after the animation ends.
  const [isAnimating, setIsAnimating] = useState(false);

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
  const { inbox, isLoading: isLoadingInbox } = useInvolvedMatches(activeProfileId);
  const conversation = inbox.find(c => c.id === conversationId);
  const otherProfile = conversation?.otherProfile;

  // Get messages
  const {
    data: messages = [],
    isLoading: isLoadingMessages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useConversationMessages(
    conversationId,
    activeProfileId,
  );
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const { mutateAsync: rollDice } = useRollDice();

  // Handle equipped die coming back from the inventory screen
  useEffect(() => {
    if (equippedDieParam) {
      setEquippedDie(equippedDieParam);
    }
  }, [equippedDieParam]);

  const queryClient = useQueryClient();

  // Roll the equipped die — API only, no animation
  const handleRollEquipped = async () => {
    if (!equippedDie || !activeProfileId || !conversationId) return;
    try {
      const result = await rollDice({
        dieType: equippedDie,
        conversationId,
        profileId: activeProfileId,
      });
      console.log(`🎲 Dice roll posted: ${equippedDie} → ${result.result}`);
      // Invalidate messages so the event message appears in chat
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
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

  const handleSend = useCallback(() => {
    if (!messageText.trim() || !activeProfileId || !conversationId) return;
    
    sendMessage({
      conversationId,
      senderProfileId: activeProfileId,
      content: messageText.trim(),
    });
    setMessageText('');
  }, [messageText, activeProfileId, conversationId, sendMessage]);

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
    height: INPUT_BAR_HEIGHT + insets.bottom + Math.abs(keyboardHeight.value) + Spacing[6],
  }));

  if (isLoadingInbox && !conversation) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen 
        options={{
          headerShown: true,
          headerTitle: '',
          headerLeft: () => (
            <Pressable 
              onPress={() => router.replace('/(tabs)/messages')} 
              style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]} 
              testID="back-button"
            >
              <Ionicons name="chevron-back" size={24} color={Colors.onSurface} />
              <View style={styles.headerProfile}>
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
              </View>
            </Pressable>
          ),
          headerStyle: { backgroundColor: Colors.surface },
          headerShadowVisible: false,
        }} 
      />

      {isLoadingMessages && messages.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.loadingText}>Reading the scrolls...</Text>
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
          renderItem={({ item }) => {
            // Event messages — centered gold pill (dice rolls, etc.)
            if (item.type === 'event') {
              // Parse dice roll pattern: "{name} rolled a {number} on a {diceType}"
              const diceMatch = item.content.match(/^(.+?) rolled a (\d+) on a (d\d+)$/);

              return (
                <View style={styles.eventContainer}>
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
                  <Text style={styles.timestamp}>
                    {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              );
            }

            // System messages — centered muted pill
            if (item.type === 'system') {
              return (
                <View style={styles.systemContainer}>
                  <View style={styles.systemBubble}>
                    <Text style={styles.systemText}>{item.content}</Text>
                  </View>
                  <Text style={styles.timestamp}>
                    {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              );
            }

            // User messages — left/right aligned bubbles
            const isMe = item.sender_profile_id === activeProfileId;
            return (
              <View style={[styles.messageBubbleContainer, isMe ? styles.myMessageContainer : styles.theirMessageContainer]}>
                <View style={[
                  styles.messageBubble, 
                  isMe ? styles.myMessageBubble : styles.theirMessageBubble
                ]}>
                  <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.theirMessageText]}>
                    {item.content}
                  </Text>
                </View>
                <Text style={styles.timestamp}>
                  {new Date(item.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            );
          }}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={<Animated.View style={listBottomSpacerStyle} />}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.loadingMoreText}>Unrolling older scrolls...</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={[styles.emptyContainer, { transform: [{ rotateX: '180deg' }] }]}>
              <Text style={styles.emptyText}>The air is thick with unspoken words.</Text>
              <Text style={styles.emptySubText}>Break the silence with a greeting.</Text>
            </View>
          }
        />
      )}

      <Animated.View style={[styles.inputWrapper, inputBarAnimatedStyle]}>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Compose a missive..."
            placeholderTextColor={Colors.outline}
            value={messageText}
            onChangeText={setMessageText}
            multiline
            maxLength={MESSAGES.MAX_MESSAGE_LENGTH}
            testID="message-input"
          />
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
              pressed && !isSending && { opacity: 0.7 }
            ]} 
            onPress={handleSend}
            disabled={!messageText.trim() || isSending}
            testID="send-button"
          >
            {isSending ? (
              <ActivityIndicator size="small" color={Colors.onPrimary} />
            ) : (
              <Ionicons name="send" size={20} color={Colors.onPrimary} />
            )}
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

