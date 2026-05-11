import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  TextInput, 
  Pressable, 
  Platform, 
  Image,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router, Stack, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../../theme';
import { useProfileContext } from '../../context/ProfileContext';
import { useInvolvedMatches, useConversationMessages, useSendMessage } from '../../hooks/useMessages';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, interpolate, Extrapolate } from 'react-native-reanimated';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { MESSAGES } from '../../constants';
import { styles } from './styles';

const INPUT_BAR_HEIGHT = MESSAGES.INPUT_BAR_HEIGHT;

function ConversationScreenInner() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const { activeProfileId } = useProfileContext();
  const [messageText, setMessageText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();

  // The methodology we're using:
  // 1. react-native-keyboard-controller's useReanimatedKeyboardAnimation for native frame-synced tracking.
  // 2. Animated.View for the input bar with absolute positioning to avoid layout thrashing.
  // 3. A dynamic spacer in the FlatList footer that perfectly mirrors the keyboard + input bar height.
  // This is recorded as the gold standard for this repo in docs/patterns/keyboard-handling.md
  
  // Native keyboard animation hook — gives us a smooth, frame-synced height value
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();

  // Get conversation info (other profile details etc.)
  const { inbox, isLoading: isLoadingInbox } = useInvolvedMatches(activeProfileId);
  const conversation = inbox.find(c => c.id === conversationId);
  const otherProfile = conversation?.otherProfile;

  // Get messages
  const { data: messages = [], isLoading: isLoadingMessages } = useConversationMessages(conversationId);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();

  const handleSend = useCallback(() => {
    if (!messageText.trim() || !activeProfileId || !conversationId) return;
    
    sendMessage({
      conversationId,
      senderProfileId: activeProfileId,
      content: messageText.trim(),
    });
    setMessageText('');
  }, [messageText, activeProfileId, conversationId, sendMessage]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

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
          data={messages}
          keyExtractor={(item) => item.message_id}
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          renderItem={({ item }) => {
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
          ListFooterComponent={<Animated.View style={listBottomSpacerStyle} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
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
            maxLength={500}
            testID="message-input"
          />
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

