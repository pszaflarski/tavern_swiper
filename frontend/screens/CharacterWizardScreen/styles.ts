import { StyleSheet, Platform } from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';

export const styles = StyleSheet.create({
  // ── Screen Container ───────────────────────────────────────────────
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: Spacing[10],
  },

  // ── Header ─────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: Spacing[5],
    paddingTop: Platform.OS === 'web' ? Spacing[8] : Spacing[16],
    paddingBottom: Spacing[4],
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    marginBottom: Spacing[1],
  },
  headerTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 26,
    color: Colors.onSurface,
    letterSpacing: 1,
  },
  headerSubtitle: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // ── Glass Panel (main wizard area) ─────────────────────────────────
  glassPanel: {
    marginHorizontal: Spacing[4],
    padding: Spacing[5],
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    minHeight: 380,
    ...Shadow.waxSeal,
  },
  stepContent: {
    flex: 1,
    minHeight: 280,
  },

  // ── Step Titles ────────────────────────────────────────────────────
  stepTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 22,
    color: Colors.tertiary,
    textAlign: 'center',
    marginBottom: Spacing[1],
  },
  stepOptionalTag: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    fontWeight: '400',
    textTransform: 'lowercase',
  },
  stepDescription: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    textAlign: 'center',
    marginBottom: Spacing[5],
    lineHeight: 18,
  },

  // ── Option Card (used for fandom, gender, race, class) ─────────────
  optionCard: {
    padding: Spacing[4],
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...Shadow.waxSeal,
  },
  optionCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceContainerHigh,
  },
  optionCardLocked: {
    opacity: 0.45,
    borderColor: Colors.surfaceContainerHighest,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  optionCardGrid: {
    padding: Spacing[4],
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.outlineVariant,
    minHeight: 120,
    justifyContent: 'space-between',
    ...Shadow.waxSeal,
  },
  optionCardGridSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceContainerHigh,
  },
  optionName: {
    fontFamily: Fonts.heroic,
    fontSize: 16,
    color: Colors.onSurface,
    fontWeight: '600',
  },
  optionNameSelected: {
    color: Colors.primaryFixed,
  },
  optionDesc: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    marginTop: Spacing[2],
    lineHeight: 16,
  },
  optionInfoContainer: {
    flex: 1,
    marginRight: Spacing[3],
  },
  optionGridTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },

  // ── Radio Indicator ────────────────────────────────────────────────
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: Colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.onPrimary,
  },

  // ── Lock Badge (Coming Soon) ───────────────────────────────────────
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surfaceContainerHighest,
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
    borderRadius: Radius.xs,
    marginLeft: Spacing[2],
  },
  lockBadgeText: {
    fontFamily: Fonts.scribe,
    fontSize: 9,
    color: Colors.outline,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // ── Options List / Grid Layout ─────────────────────────────────────
  optionsList: {
    gap: Spacing[3],
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[3],
  },
  optionsGridItem: {
    width: '48%' as any,
  },

  // ── Progress Dots ──────────────────────────────────────────────────
  progressDotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing[3],
    marginTop: Spacing[5],
  },
  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.surfaceContainerHighest,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  progressDotActive: {
    backgroundColor: Colors.tertiary,
    borderColor: Colors.tertiary,
    transform: [{ scale: 1.25 }],
  },
  progressDotCompleted: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },

  // ── Navigation Buttons ─────────────────────────────────────────────
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing[5],
    paddingTop: Spacing[4],
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[5],
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  navButtonText: {
    fontFamily: Fonts.heroic,
    fontSize: 14,
    color: Colors.outline,
    letterSpacing: 1,
  },
  navButtonPrimary: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  navButtonPrimaryText: {
    color: Colors.onPrimary,
    fontWeight: '700',
  },

  // ── Result Screen ──────────────────────────────────────────────────
  resultContainer: {
    alignItems: 'center',
    gap: Spacing[4],
    paddingBottom: Spacing[6],
  },
  resultSubtitle: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: Spacing[4],
  },

  // ── Character Card (full-bleed discovery style) ────────────────────
  characterCard: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.background,
  },
  characterImageArea: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.surfaceContainerHighest,
    justifyContent: 'center',
    alignItems: 'center',
  },
  characterImagePlaceholder: {
    fontSize: 72,
  },
  // Gradient overlay at the bottom of the image for text readability
  characterGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '50%',
  },
  // Hero info overlaid at the bottom of the image
  characterCardBody: {
    padding: Spacing[5],
    paddingBottom: Spacing[3],
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginBottom: Spacing[3],
  },
  badge: {
    paddingHorizontal: Spacing[3],
    paddingVertical: 4,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderWidth: 0,
  },
  badgeFandom: {},
  badgeRace: {},
  badgeGender: {},
  badgeText: {
    fontFamily: Fonts.scribe,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#FFFFFF',
  },
  characterClass: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    color: Colors.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 2,
  },
  characterName: {
    fontFamily: Fonts.heroic,
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    marginBottom: Spacing[1],
  },
  characterTagline: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    fontStyle: 'italic',
    color: Colors.tertiary,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    marginBottom: Spacing[2],
    lineHeight: 18,
  },
  characterBio: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
    lineHeight: 18,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // ── Carousel Nav ───────────────────────────────────────────────────
  carouselNavButton: {
    position: 'absolute',
    top: '45%',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  carouselNavLeft: {
    left: Spacing[3],
  },
  carouselNavRight: {
    right: Spacing[3],
  },

  // ── Match Counter ──────────────────────────────────────────────────
  matchCounter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    backgroundColor: Colors.surfaceContainerLowest,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1],
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  matchCounterText: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
  },

  // ── Action Buttons Row ─────────────────────────────────────────────
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing[3],
    width: '100%',
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3],
    paddingBottom: Spacing[5],
    borderTopWidth: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[4],
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  actionButtonPrimary: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  actionButtonGold: {
    backgroundColor: Colors.tertiaryContainer,
    borderColor: Colors.tertiary,
  },
  actionButtonText: {
    fontFamily: Fonts.heroic,
    fontSize: 12,
    color: Colors.outline,
    letterSpacing: 0.5,
  },
  actionButtonTextPrimary: {
    color: Colors.onPrimary,
    fontWeight: '700',
  },
  actionButtonTextGold: {
    color: Colors.onTertiaryContainer,
    fontWeight: '700',
  },

  // ── Empty/Error State ──────────────────────────────────────────────
  emptyContainer: {
    alignItems: 'center',
    padding: Spacing[8],
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: Spacing[4],
  },
  emptyTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 20,
    color: Colors.onSurface,
    marginBottom: Spacing[2],
  },
  emptyDesc: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    textAlign: 'center',
    marginBottom: Spacing[5],
  },
  resetButton: {
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[6],
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  resetButtonText: {
    fontFamily: Fonts.heroic,
    fontSize: 14,
    color: Colors.onPrimary,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // ── JSON Inspector ─────────────────────────────────────────────────
  inspectorContainer: {
    width: '100%',
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    overflow: 'hidden',
  },
  inspectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing[3],
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  inspectorHeaderText: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    color: Colors.outline,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  inspectorBody: {
    padding: Spacing[3],
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
  },
  inspectorCode: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    color: Colors.primaryFixed,
    lineHeight: 15,
  },

  // ── Adopt Success ──────────────────────────────────────────────────
  adoptingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 26, 17, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Radius.lg,
    zIndex: 100,
  },
  adoptingText: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.tertiary,
    marginTop: Spacing[4],
    letterSpacing: 1,
  },
});
