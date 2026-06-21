import { StyleSheet, Platform } from 'react-native';
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
  infoButton: {
    position: 'absolute',
    bottom: 44, 
    right: Spacing[6],
    zIndex: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)', 
    borderRadius: 24,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  detailsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(13, 17, 15, 0.9)', // Deep dark grimoire tint
    zIndex: 5,
    paddingTop: 80, // Respect header height
  },
  detailsScroll: {
    flex: 1,
  },
  detailsContent: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[10],
  },
  detailsName: {
    fontFamily: Fonts.heroic,
    fontSize: 32,
    color: Colors.primary,
    marginBottom: Spacing[1],
  },
  detailsTagline: {
    fontFamily: Fonts.scribe,
    fontSize: 16,
    fontStyle: 'italic',
    color: Colors.tertiary,
    marginBottom: Spacing[6],
  },
  detailsLabel: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 2,
    color: Colors.outline,
    marginBottom: Spacing[2],
  },
  detailsBio: {
    fontFamily: Fonts.scribe,
    fontSize: 16,
    lineHeight: 24,
    color: Colors.onSurface,
    marginBottom: Spacing[6],
  },
  divider: {
    height: 1,
    backgroundColor: Colors.outlineVariant,
    width: '100%',
    marginVertical: Spacing[6],
    opacity: 0.3,
  },
});
