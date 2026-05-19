import { StyleSheet, Platform } from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing[6],
    gap: Spacing[4],
  },
  inventoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.tertiary,
    paddingVertical: Spacing[4],
    paddingHorizontal: Spacing[10],
    borderRadius: Radius.full,
    ...Shadow.waxSeal,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  inventoryButtonText: {
    fontFamily: Fonts.scribe,
    color: Colors.onTertiary,
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  logoutButton: {
    backgroundColor: Colors.error,
    paddingVertical: Spacing[4],
    paddingHorizontal: Spacing[10],
    borderRadius: Radius.full,
    ...Shadow.waxSeal,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  logoutButtonText: {
    fontFamily: Fonts.scribe,
    color: Colors.onError,
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
