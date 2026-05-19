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
import { useInvolvedMatches, useConversationMessages, useSendMessage, useRollDice, DiceRollResult } from '../../hooks/useMessages';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, interpolate, Extrapolate } from 'react-native-reanimated';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import DiceOverlay from '../../components/DiceOverlay';
import { MESSAGES } from '../../constants';
import { styles } from './styles';

const INPUT_BAR_HEIGHT = MESSAGES.INPUT_BAR_HEIGHT;

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
          onRoll();
          return;
        }

        // Persist the new position
        const newX = posRef.current.x + gs.dx;
        const newY = posRef.current.y + gs.dy;
        posRef.current = { x: newX, y: newY };

        // If released in the input bar zone (bottom ~80px of screen), unequip
        if (gs.moveY > screenHeight - 80) {
          onDismiss();
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
  const [diceResult, setDiceResult] = useState<DiceRollResult | null>(null);
  const [hiddenMessageId, setHiddenMessageId] = useState<string | null>(null);
  const [rollKey, setRollKey] = useState(0);
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
    // Pause polling while the dice animation is playing to prevent the
    // event message from appearing before the roll finishes.
    rollingDie !== null,
  );
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();
  const { mutateAsync: rollDice, invalidateAfterRoll } = useRollDice();

  // Handle equipped die coming back from the inventory screen
  useEffect(() => {
    if (equippedDieParam) {
      setEquippedDie(equippedDieParam);
    }
  }, [equippedDieParam]);

  // Roll the equipped die
  const handleRollEquipped = async () => {
    if (!equippedDie || !activeProfileId || !conversationId) return;
    try {
      const result = await rollDice({
        dieType: equippedDie,
        conversationId,
        profileId: activeProfileId,
      });
      if (result.message_id) {
        setHiddenMessageId(result.message_id);
      }
      setDiceResult(result);
      setRollingDie(equippedDie);
      setRollKey(k => k + 1);
    } catch (err) {
      console.error('🎲 Dice roll failed:', err);
    }
  };
  const queryClient = useQueryClient();

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

  // We use an inverted FlatList — the standard pattern for chat UIs.
  // By inverting, the most recent message sits at the scroll origin (top of the
  // virtual list = bottom of the screen), so no scrollToEnd hacks are needed.
  // The data array is reversed so visual order stays chronological.
  const invertedMessages = useMemo(
    () => (hiddenMessageId ? messages.filter(m => m.message_id !== hiddenMessageId) : messages).slice().reverse(),
    [messages, hiddenMessageId],
  );

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
            <View style={[styles.emptyContainer, { transform: [{ scaleY: -1 }] }]}>
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
          onDismiss={() => setEquippedDie(null)}
          screenHeight={screenHeight}
        />
      )}

      {/* Dice overlay — renders on top of everything */}
      <DiceOverlay
        visible={rollingDie !== null}
        dieType={rollingDie ?? 'd6'}
        rollKey={rollKey}
        desiredValue={diceResult?.result}
        onResult={(value: number) => {
          console.log(`\ud83c\udfb2 Rolled ${rollingDie}: ${value}`);
          // Reveal the event message now that the animation is done.
          // The overlay stays visible until the user dismisses or re-rolls.
          setHiddenMessageId(null);
          invalidateAfterRoll();
        }}
        onDismiss={() => {
          // Clean up — also reveal any hidden message if dismissed early
          setHiddenMessageId(null);
          setRollingDie(null);
          setDiceResult(null);
          invalidateAfterRoll();
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

