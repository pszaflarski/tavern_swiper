import React, { useState, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Platform,
  Dimensions,
} from 'react-native';
import { Colors, Fonts, Radius, Spacing, Shadow } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { processProfileAsset, CropData } from '../lib/imageProcessing';

// Web-only imports
let ReactCrop: any;
let centerCrop: any;
let makeAspectCrop: any;

if (Platform.OS === 'web') {
  // Use try-catch or dynamic require to avoid bundling issues on Native
  try {
    const rCrop = require('react-image-crop');
    ReactCrop = rCrop.ReactCrop;
    centerCrop = rCrop.centerCrop;
    makeAspectCrop = rCrop.makeAspectCrop;
    // NOTE: react-image-crop CSS must be imported in your global web environment (e.g. index.css or _layout.tsx)
    // to avoid Jest transformation issues in React Native environments.
  } catch (e) {
    console.warn('Failed to load react-image-crop for web', e);
  }
}

interface ImageCropperModalProps {
  isVisible: boolean;
  imageUri: string | null;
  onClose: () => void;
  onCropComplete: (processedUri: string) => void;
}

export const ImageCropperModal: React.FC<ImageCropperModalProps> = ({
  isVisible,
  imageUri,
  onClose,
  onCropComplete,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [crop, setCrop] = useState<any>();
  const [completedCrop, setCompletedCrop] = useState<any>();
  const imgRef = useRef<HTMLImageElement | null>(null);

  const ASPECT_RATIO = 4 / 5;

  const onImageLoad = (e: any) => {
    if (Platform.OS === 'web' && centerCrop) {
      const { width, height } = e.currentTarget;
      const initialCrop = centerCrop(
        makeAspectCrop(
          {
            unit: '%',
            width: 90,
          },
          ASPECT_RATIO,
          width,
          height
        ),
        width,
        height
      );
      setCrop(initialCrop);
    }
  };

  const handleConfirm = async () => {
    if (!imageUri) return;

    setIsProcessing(true);
    try {
      let cropData: CropData | undefined;

      if (Platform.OS === 'web' && completedCrop && imgRef.current) {
        // Map relative % or px crop to actual image pixels
        const scaleX = imgRef.current.naturalWidth / imgRef.current.width;
        const scaleY = imgRef.current.naturalHeight / imgRef.current.height;

        cropData = {
          x: Math.round(completedCrop.x * scaleX),
          y: Math.round(completedCrop.y * scaleY),
          width: Math.round(completedCrop.width * scaleX),
          height: Math.round(completedCrop.height * scaleY),
        };
      }

      // On Mobile, the cropData might be undefined if the user already cropped via OS,
      // but processProfileAsset handles this and still ensures 1080x1350.
      const processedUri = await processProfileAsset(imageUri, cropData);
      onCropComplete(processedUri);
      onClose();
    } catch (error) {
      console.error('Cropping failed:', error);
      // In a real app, show a toast here
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      visible={isVisible}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Refine Vision</Text>
            <TouchableOpacity onPress={onClose} disabled={isProcessing}>
              <Ionicons name="close" size={24} color={Colors.outline} />
            </TouchableOpacity>
          </View>

          <View style={styles.previewContainer}>
            {imageUri ? (
              Platform.OS === 'web' && ReactCrop ? (
                <ReactCrop
                  crop={crop}
                  onChange={(c: any) => setCrop(c)}
                  onComplete={(c: any) => setCompletedCrop(c)}
                  aspect={ASPECT_RATIO}
                  style={{ maxHeight: '60vh' }}
                >
                  <img
                    ref={imgRef}
                    src={imageUri}
                    alt="Source"
                    style={{ maxHeight: '60vh', objectFit: 'contain' }}
                    onLoad={onImageLoad}
                  />
                </ReactCrop>
              ) : (
                <Image
                  source={{ uri: imageUri }}
                  style={styles.mobilePreview}
                  resizeMode="contain"
                />
              )
            ) : (
              <ActivityIndicator color={Colors.primary} />
            )}
          </View>

          <View style={styles.footer}>
            <Text style={styles.hint}>
              {Platform.OS === 'web' 
                ? 'Align your hero within the frame' 
                : 'Transmuting to canonical form...'}
            </Text>
            <TouchableOpacity
              style={[styles.confirmButton, isProcessing && styles.disabledButton]}
              onPress={handleConfirm}
              disabled={isProcessing}
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
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing[4],
  },
  content: {
    backgroundColor: Colors.surfaceContainer,
    borderRadius: Radius.lg,
    width: '100%',
    maxWidth: 600,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    ...Shadow.waxSeal,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
  },
  title: {
    fontFamily: Fonts.heroic,
    fontSize: 20,
    color: Colors.onSurface,
  },
  previewContainer: {
    backgroundColor: '#000',
    minHeight: 300,
    maxHeight: '70%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mobilePreview: {
    width: '100%',
    height: 300,
  },
  footer: {
    padding: Spacing[4],
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
  },
  hint: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    marginBottom: Spacing[4],
    fontStyle: 'italic',
  },
  confirmButton: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[8],
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  confirmText: {
    fontFamily: Fonts.heroic,
    fontSize: 16,
    color: Colors.onPrimary,
  },
});
