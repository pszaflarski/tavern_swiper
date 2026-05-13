import { StyleSheet, Platform } from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  profileTabsContainer: {
    backgroundColor: Colors.surfaceContainerLowest,
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
  },
  profileTabsContent: {
    paddingHorizontal: Spacing[6],
    gap: Spacing[4],
  },
  profileTab: {
    height: 100,
    aspectRatio: 9 / 16,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 2,
    borderColor: 'transparent',
    ...Shadow.waxSeal,
  },
  activeProfileTab: {
    borderColor: Colors.tertiary,
  },
  profileTabImage: {
    width: '100%',
    height: '100%',
  },
  profileTabOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    padding: 4,
  },
  activeProfileTabOverlay: {
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  profileTabName: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    color: Colors.onPrimary,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  activeProfileTabName: {
    color: Colors.tertiary,
  },
  sectionHeader: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[6],
    paddingBottom: Spacing[2],
  },
  sectionTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.onSurface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
    paddingBottom: Spacing[1],
  },
  newMatchesContainer: {
    paddingVertical: Spacing[3],
  },
  newMatchesContent: {
    paddingHorizontal: Spacing[6],
    gap: Spacing[4],
  },
  newMatchItem: {
    width: 56, // height 100 * 9/16 ≈ 56
    alignItems: 'center',
  },
  newMatchImage: {
    width: '100%',
    height: 100,
    aspectRatio: 9 / 16,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  newMatchName: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    marginTop: 4,
  },
  inboxContainer: {
    paddingHorizontal: Spacing[6],
    gap: Spacing[4],
    marginTop: Spacing[2],
  },
  inboxItem: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    ...Shadow.waxSeal,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  inboxContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing[2],
  },
  inboxBanner: {
    width: 32,
    height: 56,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  inboxTextContainer: {
    flex: 1,
    paddingLeft: Spacing[4],
    paddingRight: Spacing[4],
    justifyContent: 'center',
  },
  inboxName: {
    fontFamily: Fonts.heroic,
    fontSize: 16,
    color: Colors.primary,
  },
  inboxLastMessage: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    marginTop: 2,
  },
  emptyText: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    textAlign: 'center',
    marginTop: Spacing[4],
    fontStyle: 'italic',
  },
  headerSub: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.error,
    borderWidth: 2,
    borderColor: Colors.surfaceContainerLow,
  },
  inboxAvatarContainer: {
    position: 'relative',
  },
  profileUnreadDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.error,
    borderWidth: 2,
    borderColor: Colors.surfaceContainerLowest,
  },
});
