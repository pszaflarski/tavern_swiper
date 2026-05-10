import { StyleSheet } from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../theme';

export const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 1)', // Solid black backdrop
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    backgroundColor: Colors.surfaceContainer,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing[4],
    backgroundColor: Colors.surfaceContainerHigh,
    zIndex: 10,
  },
  title: {
    fontFamily: Fonts.heroic,
    fontSize: 20,
    color: Colors.onSurface,
  },
  previewContainer: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  cropperStack: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageWrapper: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shroudOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'column',
    zIndex: 5,
  },
  shroudRow: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  shroudCell: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
  },
  aperture: {
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    backgroundColor: 'transparent',
  },
  zoomOverlay: {
    position: 'absolute',
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    padding: Spacing[2],
    borderRadius: Radius.full,
    zIndex: 25,
    backdropFilter: 'blur(10px)',
  },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomSpacer: {
    width: Spacing[4],
  },
  footer: {
    padding: Spacing[6],
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
    zIndex: 10,
  },
  hint: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    marginBottom: Spacing[4],
  },
  confirmButton: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    paddingVertical: Spacing[4],
    paddingHorizontal: Spacing[10],
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 240,
    ...Shadow.waxSeal,
  },
  disabledButton: {
    opacity: 0.5,
  },
  confirmText: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.onPrimary,
  },
});
