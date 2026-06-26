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
  // Event & system messages — centered pill
  eventContainer: {
    alignSelf: 'center',
    alignItems: 'center',
    maxWidth: '90%',
    marginVertical: Spacing[3],
  },
  eventBubble: {
    paddingVertical: Spacing[1],
    paddingHorizontal: Spacing[4],
    borderRadius: Radius.xl,
    backgroundColor: Colors.tertiaryContainer,
    borderWidth: 1,
    borderColor: Colors.tertiary,
  },
  eventText: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.tertiaryFixedDim,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  eventHighlight: {
    color: '#64b5f6',
    fontWeight: '700',
    fontStyle: 'normal',
  },
  systemContainer: {
    alignSelf: 'center',
    alignItems: 'center',
    maxWidth: '90%',
    marginVertical: Spacing[3],
  },
  systemBubble: {
    paddingVertical: Spacing[1],
    paddingHorizontal: Spacing[4],
    borderRadius: Radius.xl,
    backgroundColor: Colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  systemText: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    fontStyle: 'italic',
    textAlign: 'center',
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
  messageTextNarration: {
    fontStyle: 'italic',
  },
  myMessageTextNarration: {
    color: Colors.tertiaryFixed,
  },
  theirMessageTextNarration: {
    color: Colors.tertiaryFixedDim,
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
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
    overflow: 'visible',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing[2],
    paddingRight: Spacing[4],
    paddingTop: Spacing[3], // Symmetrical vertical padding
    paddingBottom: 0, // Bottom padding is handled by the animated wrapper
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
  loadingMore: {
    paddingVertical: Spacing[4],
    alignItems: 'center' as const,
  },
  loadingMoreText: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    marginTop: Spacing[1],
    fontStyle: 'italic' as const,
  },
  equippedDieFloat: {
    position: 'absolute',
    bottom: 80,
    left: Spacing[4],
    zIndex: 10,
  },
  equippedDieCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: Colors.tertiary,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadow.waxSeal,
  },
  equippedDieImage: {
    width: 32,
    height: 32,
  },
  equippedDieDismiss: {
    position: 'absolute',
    top: -4,
    right: -4,
  },
  typingContainer: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing[2],
    paddingLeft: Spacing[1],
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[4],
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainerHigh,
    borderBottomLeftRadius: Radius.xs,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    gap: 4,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.outline,
  },
  modeToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[2],
    paddingBottom: Spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
    gap: Spacing[2],
  },
  modeTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[1.5],
    paddingHorizontal: Spacing[3],
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainer,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  modeTabActive: {
    backgroundColor: '#544d2d',
    borderColor: Colors.tertiary,
  },
  modeTabText: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.outline,
  },
  modeTabTextActive: {
    color: Colors.tertiaryFixedDim,
  },
});
