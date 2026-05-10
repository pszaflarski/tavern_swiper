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
  loadingText: {
    marginTop: Spacing[4],
    fontFamily: Fonts.scribe,
    color: Colors.outline,
  },
  scrollContent: {
    padding: Spacing[6],
  },
  headerButton: {
    padding: 8,
  },
  saveActionText: {
    fontFamily: Fonts.heroic,
    fontSize: 16,
    color: Colors.primary,
  },
  gridSection: {
    alignItems: 'center',
    marginBottom: Spacing[8],
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing[3],
  },
  filledSlot: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceContainerHigh,
    ...Shadow.waxSeal,
    borderWidth: 1.5,
    borderColor: Colors.tertiary,
  },
  emptySlot: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.outlineVariant,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptySlotContent: {
    alignItems: 'center',
  },
  addLabel: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    color: Colors.outline,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  removeSeal: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: Colors.surface,
    borderRadius: 10,
  },
  gridHint: {
    marginTop: Spacing[3],
    fontFamily: Fonts.scribe,
    fontSize: 12,
    fontStyle: 'italic',
    color: Colors.outline,
    textAlign: 'center',
  },
  formSection: {
    marginBottom: Spacing[8],
  },
  sectionTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.onSurface,
    marginBottom: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
    paddingBottom: Spacing[2],
  },
  inputGroup: {
    marginBottom: Spacing[4],
  },
  label: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    marginBottom: Spacing[2],
    marginLeft: 4,
  },
  input: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing[3],
    color: Colors.onSurface,
    fontFamily: Fonts.scribe,
    fontSize: 15,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  choiceRow: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  choiceBtn: {
    flex: 1,
    paddingVertical: Spacing[3],
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
  },
  choiceBtnActive: {
    backgroundColor: Colors.primaryContainer,
    borderColor: Colors.primary,
  },
  choiceText: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
  },
  choiceTextActive: {
    color: Colors.onPrimaryContainer,
    fontWeight: '600',
  },
  forgeButton: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    padding: Spacing[4],
    borderRadius: Radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadow.waxSeal,
    marginTop: Spacing[4],
  },
  forgeButtonDisabled: {
    opacity: 0.6,
  },
  forgeButtonText: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.onPrimary,
  },
  footerPlaceholder: {
    height: 40,
  },
  ocToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[2],
  },
  ocCheckbox: {
    width: 22,
    height: 22,
    borderRadius: Radius.xs,
    borderWidth: 2,
    borderColor: Colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing[3],
  },
  ocCheckboxActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  ocLabel: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.onSurface,
  },
});
