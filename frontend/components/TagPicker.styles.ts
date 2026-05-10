import { StyleSheet } from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../theme';

export const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing[4],
  },
  label: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    marginBottom: Spacing[2],
    marginLeft: 4,
  },
  searchRow: {
    marginBottom: Spacing[3],
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    paddingHorizontal: Spacing[3],
  },
  searchIcon: {
    marginRight: Spacing[2],
  },
  searchInput: {
    flex: 1,
    paddingVertical: Spacing[2],
    color: Colors.onSurface,
    fontFamily: Fonts.scribe,
    fontSize: 14,
  },
  clearButton: {
    padding: 4,
  },
  tagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[3],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
  },
  tagChipSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tagChipPending: {
    borderColor: Colors.tertiary,
    borderStyle: 'dashed',
  },
  tagChipText: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.onSurfaceVariant,
  },
  tagChipTextSelected: {
    color: Colors.onPrimary,
    fontWeight: '600',
  },
  suggestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[4],
    marginTop: Spacing[2],
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.tertiary,
    borderStyle: 'dashed',
    backgroundColor: Colors.surfaceContainerLow,
  },
  suggestText: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.tertiary,
    marginLeft: Spacing[2],
    fontStyle: 'italic',
  },
  selectedSummary: {
    marginTop: Spacing[3],
  },
  selectedLabel: {
    fontFamily: Fonts.scribe,
    fontSize: 11,
    color: Colors.outline,
    marginBottom: Spacing[1],
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  selectedChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingLeft: Spacing[3],
    paddingRight: Spacing[2],
    borderRadius: Radius.full,
    backgroundColor: Colors.primaryContainer,
  },
  selectedChipText: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.onPrimaryContainer,
  },
});
