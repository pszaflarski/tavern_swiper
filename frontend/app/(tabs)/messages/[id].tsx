import React, { useState, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TextInput, 
  TouchableOpacity, 
  KeyboardAvoidingView, 
  Platform, 
  Image,
  ActivityIndicator,
  Keyboard
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../../theme';
import { useProfileContext } from '../../../context/ProfileContext';
import { useInvolvedMatches, useConversationMessages, useSendMessage } from '../../../hooks/useMessages';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenErrorBoundary from '../../../components/ScreenErrorBoundary';

const PLACEHOLDER_IMAGE = require('../../../assets/images/placeholder/hero1.jpeg');

function ConversationScreenInner() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const { activeProfileId } = useProfileContext();
  const [messageText, setMessageText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Get conversation info (other profile details etc.)
  const { inbox, isLoading: isLoadingInbox } = useInvolvedMatches(activeProfileId);
  const conversation = inbox.find(c => c.id === conversationId);
  const otherProfile = conversation?.otherProfile;

  // Get messages
  const { data: messages = [], isLoading: isLoadingMessages } = useConversationMessages(conversationId);
  const { mutate: sendMessage, isPending: isSending } = useSendMessage();

  const handleSend = () => {
    if (!messageText.trim() || !activeProfileId || !conversationId) return;
    
    sendMessage({
      conversationId,
      senderProfileId: activeProfileId,
      content: messageText.trim(),
    });
    setMessageText('');
  };

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  if (isLoadingInbox && !conversation) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 80}
      enabled={true}
    >
      <Stack.Screen 
        options={{
          headerShown: true,
          headerTitle: '',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="chevron-back" size={24} color={Colors.onSurface} />
              <View style={styles.headerProfile}>
                <Image 
                  source={otherProfile?.image_urls?.[0] ? { uri: otherProfile.image_urls[0] } : PLACEHOLDER_IMAGE} 
                  style={styles.headerAvatar} 
                />
                <View>
                  <Text style={styles.headerName}>{otherProfile?.display_name || 'Traveler'}</Text>
                  <Text style={styles.headerStatus}>Online in the tavern</Text>
                </View>
              </View>
            </TouchableOpacity>
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
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>The air is thick with unspoken words.</Text>
              <Text style={styles.emptySubText}>Break the silence with a greeting.</Text>
            </View>
          }
        />
      )}

      <View style={[
        styles.inputContainer, 
        { paddingBottom: Spacing[4], paddingTop: Spacing[2] }
      ]}>
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
        <TouchableOpacity 
          style={[styles.sendButton, !messageText.trim() && styles.sendButtonDisabled]} 
          onPress={handleSend}
          disabled={!messageText.trim() || isSending}
          testID="send-button"
        >
          {isSending ? (
            <ActivityIndicator size="small" color={Colors.onPrimary} />
          ) : (
            <Ionicons name="send" size={20} color={Colors.onPrimary} />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function ConversationScreen() {
  return (
    <ScreenErrorBoundary fallbackMessage="The raven lost your conversation scroll.">
      <ConversationScreenInner />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: Spacing[2],
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHigh,
    marginRight: Spacing[2],
  },
  headerName: {
    fontFamily: Fonts.heroic,
    fontSize: 16,
    color: Colors.onSurface,
  },
  headerStatus: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  messageList: {
    padding: Spacing[4],
    paddingBottom: Spacing[6],
  },
  messageBubbleContainer: {
    marginVertical: Spacing[2],
    maxWidth: '80%',
  },
  myMessageContainer: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  theirMessageContainer: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  messageBubble: {
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[4],
    borderRadius: Radius.md,
    ...Shadow.waxSeal,
  },
  myMessageBubble: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: Radius.xs,
  },
  theirMessageBubble: {
    backgroundColor: Colors.surfaceContainerHigh,
    borderBottomLeftRadius: Radius.xs,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  messageText: {
    fontFamily: Fonts.scribe,
    fontSize: 15,
    lineHeight: 20,
  },
  myMessageText: {
    color: Colors.onPrimary,
  },
  theirMessageText: {
    color: Colors.onSurface,
  },
  timestamp: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    color: Colors.outline,
    marginTop: 2,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surfaceContainer,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing[4],
    paddingTop: Platform.OS === 'ios' ? Spacing[2] : Spacing[1],
    paddingBottom: Platform.OS === 'ios' ? Spacing[2] : Spacing[1],
    fontFamily: Fonts.scribe,
    fontSize: 15,
    color: Colors.onSurface,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: Spacing[2],
  },
  sendButtonDisabled: {
    backgroundColor: Colors.surfaceVariant,
    opacity: 0.5,
  },
  loadingText: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    marginTop: Spacing[2],
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing[20],
  },
  emptyText: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.outline,
    textAlign: 'center',
  },
  emptySubText: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    textAlign: 'center',
    marginTop: Spacing[2],
    fontStyle: 'italic',
  }
});
