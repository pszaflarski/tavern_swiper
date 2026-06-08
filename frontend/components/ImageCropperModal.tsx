import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  PixelRatio,
  useWindowDimensions,
  Image,
} from 'react-native';
import { Colors, Fonts, Radius, Spacing, Shadow } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { processProfileAsset, calculateTransformCrop } from '../lib/imageProcessing';
import { styles } from './ImageCropperModal.styles';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';

interface ImageCropperModalProps {
  isVisible: boolean;
  imageUri: string | null;
  onClose: () => void;
  onCropComplete: (processedUri: string) => void;
}

const ASPECT_RATIO = 4 / 5;

export const ImageCropperModal: React.FC<ImageCropperModalProps> = ({
  isVisible,
  imageUri,
  onClose,
  onCropComplete,
}) => {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [isProcessing, setIsProcessing] = useState(false);
  const [imgLayout, setImgLayout] = useState({ naturalWidth: 0, naturalHeight: 0 });

  // 1. Dynamic Aperture Calculation to ensure it's NEVER obscured
  // Estimate header and footer reserved space
  const headerHeight = Platform.OS === 'ios' ? 100 : 70;
  const footerHeight = 160;
  const availableHeight = windowHeight - headerHeight - footerHeight - 40; // 40 for extra breathing room
  const availableWidth = windowWidth * 0.9;

  const apertureWidth = useMemo(() => {
    const portraitWidth = Math.min(availableWidth, availableHeight * ASPECT_RATIO);
    return portraitWidth;
  }, [availableWidth, availableHeight]);

  const apertureHeight = useMemo(() => apertureWidth / ASPECT_RATIO, [apertureWidth]);

  // Gesture State
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // Load natural dimensions & initialize scale
  useEffect(() => {
    if (imageUri) {
      Image.getSize(imageUri, (w, h) => {
        setImgLayout({ naturalWidth: w, naturalHeight: h });
        
        // Initial fitting logic: scale to fill frame (Cover)
        const minScale = Math.max(apertureWidth / w, apertureHeight / h);
        scale.value = minScale;
        savedScale.value = minScale;
        translateX.value = 0;
        translateY.value = 0;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }, (err) => {
        console.error('Failed to get image size:', err);
      });
    }
  }, [imageUri, apertureWidth, apertureHeight]);

  const getBounds = useCallback((currentScale: number) => {
    'worklet';
    if (!imgLayout.naturalWidth) return { maxX: 0, maxY: 0, minScale: 1 };
    
    const scaledWidth = imgLayout.naturalWidth * currentScale;
    const scaledHeight = imgLayout.naturalHeight * currentScale;

    // Max translation allowed to stay within frame
    const maxX = Math.max(0, (scaledWidth - apertureWidth) / 2);
    const maxY = Math.max(0, (scaledHeight - apertureHeight) / 2);

    return { 
      maxX, 
      maxY, 
      minScale: Math.max(apertureWidth / imgLayout.naturalWidth, apertureHeight / imgLayout.naturalHeight) 
    };
  }, [imgLayout, apertureWidth, apertureHeight]);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      const { maxX, maxY } = getBounds(scale.value);
      translateX.value = Math.max(-maxX, Math.min(maxX, savedTranslateX.value + event.translationX));
      translateY.value = Math.max(-maxY, Math.min(maxY, savedTranslateY.value + event.translationY));
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate((event) => {
      const { minScale } = getBounds(1);
      const newScale = Math.max(minScale, savedScale.value * event.scale);
      scale.value = newScale;

      const { maxX, maxY } = getBounds(newScale);
      translateX.value = Math.max(-maxX, Math.min(maxX, translateX.value));
      translateY.value = Math.max(-maxY, Math.min(maxY, translateY.value));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const handleZoom = (delta: number) => {
    const { minScale } = getBounds(1);
    const nextScale = Math.max(minScale, scale.value + delta);
    
    scale.value = withSpring(nextScale);
    savedScale.value = nextScale;

    // Re-clamp translation after zoom
    const { maxX, maxY } = getBounds(nextScale);
    translateX.value = withSpring(Math.max(-maxX, Math.min(maxX, translateX.value)));
    translateY.value = withSpring(Math.max(-maxY, Math.min(maxY, translateY.value)));
    
    savedTranslateX.value = translateX.value;
    savedTranslateY.value = translateY.value;
  };

  const handleConfirm = async () => {
    if (!imageUri || imgLayout.naturalWidth === 0) return;

    setIsProcessing(true);
    try {
      // On Android, Image.getSize() returns physical pixels but the aperture
      // and gesture translations are in dp.  Pass the device pixel ratio so
      // calculateTransformCrop can bridge the two coordinate spaces.
      // iOS returns dp-equivalent values, so pixelRatio is 1.
      const pr = Platform.OS === 'android' ? PixelRatio.get() : 1;

      const cropData = calculateTransformCrop(
        { width: imgLayout.naturalWidth, height: imgLayout.naturalHeight },
        { width: apertureWidth, height: apertureHeight },
        scale.value,
        translateX.value,
        translateY.value,
        pr
      );

      const processedUri = await processProfileAsset(imageUri, cropData);

      onCropComplete(processedUri);
      onClose();
    } catch (error) {
      console.error('Finalization failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal visible={isVisible} animationType="fade" transparent={true} onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.overlay}>
          <View style={styles.content}>
            <View style={styles.header}>
              <Text style={styles.title}>Refine Vision</Text>
              <TouchableOpacity onPress={onClose} disabled={isProcessing} testID="close-cropper-button">
                <Ionicons name="close" size={24} color={Colors.outline} />
              </TouchableOpacity>
            </View>

            <View style={styles.previewContainer}>
              {imageUri && imgLayout.naturalWidth > 0 ? (
                <View style={styles.cropperStack}>
                  <GestureDetector gesture={Gesture.Simultaneous(panGesture, pinchGesture)}>
                    <Animated.View style={styles.imageWrapper}>
                      <Animated.Image
                        source={{ uri: imageUri }}
                        style={[
                          { width: imgLayout.naturalWidth, height: imgLayout.naturalHeight },
                          animatedStyle
                        ]}
                        resizeMode="contain"
                      />
                    </Animated.View>
                  </GestureDetector>
                  
                  {/* The Portal (Aperture) */}
                  <View style={styles.shroudOverlay} pointerEvents="none">
                    <View style={styles.shroudRow} />
                    <View style={{ flexDirection: 'row', height: apertureHeight }}>
                      <View style={styles.shroudCell} />
                      <View style={[styles.aperture, { width: apertureWidth, height: apertureHeight }]} />
                      <View style={styles.shroudCell} />
                    </View>
                    <View style={styles.shroudRow} />
                  </View>

                  {/* Zoom Controls Overlay - Bottom of portal area */}
                  <View style={styles.zoomOverlay}>
                    <TouchableOpacity style={styles.zoomButton} onPress={() => handleZoom(-0.25)} testID="zoom-out-button">
                      <Ionicons name="remove" size={24} color="#FFF" />
                    </TouchableOpacity>
                    <View style={styles.zoomSpacer} />
                    <TouchableOpacity style={styles.zoomButton} onPress={() => handleZoom(0.25)} testID="zoom-in-button">
                      <Ionicons name="add" size={24} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <ActivityIndicator color={Colors.primary} />
              )}
            </View>

            <View style={styles.footer}>
              <Text style={styles.hint}>Drag to align • Use ± buttons to zoom</Text>
              <TouchableOpacity
                style={[styles.confirmButton, isProcessing && styles.disabledButton]}
                onPress={handleConfirm}
                disabled={isProcessing}
                testID="finalize-ritual-button"
              >
                {isProcessing ? (
                  <ActivityIndicator color={Colors.onPrimary} />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={18} color={Colors.onPrimary} style={{ marginRight: 8 }} />
                    <Text style={styles.confirmText}>Finalize Ritual</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

