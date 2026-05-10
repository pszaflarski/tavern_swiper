import { StyleSheet } from 'react-native';
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
  },
  logoutButton: {
    backgroundColor: Colors.error,
    paddingVertical: Spacing[4],
    paddingHorizontal: Spacing[10],
    borderRadius: Radius.full,
    ...Shadow.waxSeal,
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
