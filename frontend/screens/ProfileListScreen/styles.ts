import { StyleSheet, Platform } from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  testerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceContainerHighest,
    paddingVertical: Spacing[2],
    marginHorizontal: Spacing[4],
    marginBottom: Spacing[4],
    borderRadius: Radius.sm,
    gap: Spacing[2],
    borderWidth: 1,
    borderColor: Colors.tertiaryContainer,
  },
  testerText: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.tertiary,
    letterSpacing: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  loadingText: {
    marginTop: Spacing[4],
    fontFamily: Fonts.scribe,
    color: Colors.outline,
    letterSpacing: 1,
  },
  listContent: {
    padding: Spacing[4],
    gap: Spacing[4],
  },
  cardContainer: {
    marginBottom: Spacing[2],
  },

  // ── Card base ──────────────────────────────────────────
  profileCard: {
    minHeight: 96,
    padding: Spacing[4],
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.outlineVariant,
    overflow: 'hidden',
    ...Shadow.waxSeal,
  },
  activeProfileCard: {
    borderColor: Colors.tertiary,
    backgroundColor: Colors.surfaceContainerHigh,
  },
  inactiveProfileCard: {
    borderColor: Colors.primary,
  },

  // ── Normal card content (avatar + name + hamburger) ────
  cardNormalContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },

  profileImageContainer: {
    position: 'relative',
    marginRight: Spacing[3],
  },
  profileImage: {
    height: 80,
    aspectRatio: 9 / 16,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceVariant,
  },
  profileImagePlaceholder: {
    height: 80,
    aspectRatio: 9 / 16,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceVariant,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderEmoji: {
    fontSize: 20,
  },
  activeBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    zIndex: 1,
  },

  profileInfo: {
    flex: 1,
    marginRight: Spacing[2],
  },
  profileName: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.onSurface,
    marginBottom: 2,
  },
  activeProfileName: {
    color: Colors.tertiary,
  },
  profileTagline: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    marginTop: 4,
    fontStyle: 'italic',
  },

  // ── Hamburger button ───────────────────────────────────
  hamburgerButton: {
    padding: Spacing[3],
    borderRadius: Radius.sm,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },

  // ── Expanded actions overlay ───────────────────────────
  expandedActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing[1],
  },
  expandedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[4],
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceContainerHighest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    minWidth: '45%' as any,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  expandedButtonSelect: {
    borderColor: Colors.tertiaryContainer,
    backgroundColor: Colors.surfaceContainerHigh,
  },
  expandedButtonDanger: {
    borderColor: 'rgba(255, 180, 171, 0.25)',
  },
  expandedButtonCancel: {
    backgroundColor: Colors.surfaceContainerLow,
    borderColor: Colors.outlineVariant,
  },
  expandedButtonPressed: {
    opacity: 0.6,
  },
  expandedButtonText: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primaryFixed,
    letterSpacing: 0.5,
  },
  expandedButtonTextSelect: {
    color: Colors.tertiary,
  },
  expandedButtonTextDanger: {
    color: Colors.error,
  },
  expandedButtonTextCancel: {
    color: Colors.outline,
  },

  // ── Legacy styles kept for non-card elements ───────────
  profileClass: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: Spacing[4],
  },
  emptyTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 24,
    color: Colors.onSurface,
    marginBottom: Spacing[2],
  },
  emptyDesc: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing[8],
    paddingHorizontal: Spacing[6],
  },
  emptyCtaButton: {
    width: 'auto' as any,
    paddingHorizontal: Spacing[6],
    height: 64,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceContainerLowest,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadow.waxSeal,
  },
  emptyCtaText: {
    color: Colors.primary,
    fontFamily: Fonts.scribe,
    fontWeight: '600' as const,
    letterSpacing: 1,
  },
  addProfileButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[4],
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderStyle: 'dashed',
    marginTop: Spacing[2],
    marginBottom: Spacing[10],
    minHeight: 64,
  },
});
