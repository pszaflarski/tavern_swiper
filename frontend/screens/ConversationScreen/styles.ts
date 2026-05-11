import { StyleSheet, Platform } from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';

export const styles = StyleSheet.create({
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
  inputWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surfaceContainerLowest, // Solid background restored
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3], // Symmetrical vertical padding
    paddingBottom: 0, // Bottom padding is handled by the animated wrapper
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surfaceContainer,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[2],
    paddingBottom: Spacing[2],
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
  },
  diceToggle: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: Spacing[2],
  },
  diceToggleActive: {
    backgroundColor: Colors.tertiaryContainer,
  },
});
