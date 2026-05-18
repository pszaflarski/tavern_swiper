import { StyleSheet } from 'react-native';
import { Colors, Fonts, Spacing } from '../../theme';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  headerButton: {
    padding: 8,
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
  errorText: {
    marginTop: Spacing[4],
    fontFamily: Fonts.scribe,
    color: Colors.error,
  },
  cardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionsContainer: {
    position: 'absolute',
    bottom: Spacing[6],
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  instructionsText: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    opacity: 0.8,
  },
  indicatorContainer: {
    position: 'absolute',
    top: Spacing[4],
    left: Spacing[4],
    right: Spacing[4],
    flexDirection: 'row',
    gap: 4,
    zIndex: 10,
  },
  indicator: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
});
