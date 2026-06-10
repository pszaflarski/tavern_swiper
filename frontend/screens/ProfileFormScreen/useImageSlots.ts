import { useState } from 'react';
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { PROFILE } from '../../constants';
import { preprocessForCropper, PreprocessResult } from '../../lib/imageProcessing';

export function useImageSlots(initialImages: string[] = []) {
  const [imageUrls, setImageUrls] = useState<string[]>(initialImages);
  
  // Image Processing State
  const [isCropperVisible, setIsCropperVisible] = useState(false);
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);
  const [pendingImageDims, setPendingImageDims] = useState<{ width: number; height: number } | null>(null);
  const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null);

  const pickImage = async (index: number) => {
    if (imageUrls.length >= PROFILE.MAX_IMAGES && !imageUrls[index]) {
      Alert.alert('Full Arsenal', 'A hero can only carry six relics of their past.');
      return;
    }

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permissionResult.granted === false) {
      Alert.alert('Vision Denied', 'The camera roll requires your permission to reveal its secrets.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false, // Always false — our ImageCropperModal handles cropping uniformly
      quality: 1, // Keep original quality for the cropper; we compress in the pipeline
    });

    if (!result.canceled) {
      // Show the cropper immediately with a loading spinner while we preprocess.
      setPendingImageUri(null);
      setPendingImageDims(null);
      setActiveSlotIndex(index);
      setIsCropperVisible(true);

      try {
        // Preprocess: resize to target dimensions (1080/1350) and bake in
        // EXIF orientation before the cropper sees the image.
        const preprocessed = await preprocessForCropper(result.assets[0].uri);

        setPendingImageUri(preprocessed.uri);
        setPendingImageDims({ width: preprocessed.width, height: preprocessed.height });
      } catch (error) {
        console.error('Image preprocessing failed:', error);
        setIsCropperVisible(false);
        Alert.alert('Vision Obscured', 'The image could not be prepared. Please try a different one.');
      }
    }
  };

  const handleCropComplete = (processedUri: string) => {
    const newImages = [...imageUrls];
    if (activeSlotIndex !== null && activeSlotIndex < newImages.length) {
      newImages[activeSlotIndex] = processedUri;
    } else {
      newImages.push(processedUri);
    }
    setImageUrls(newImages);
  };

  const removeImage = (index: number) => {
    const newImages = [...imageUrls];
    newImages.splice(index, 1);
    setImageUrls(newImages);
  };

  // Helper to convert local URIs to Blobs/Files for upload
  const cleanupCache = async (uris: string[]) => {
    if (Platform.OS === 'web') return;
    for (const uri of uris) {
      if (uri.startsWith('file://')) {
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch (e) {
          console.warn('Failed to purge temporary vision:', uri);
        }
      }
    }
  };

  return {
    imageUrls,
    setImageUrls,
    isCropperVisible,
    setIsCropperVisible,
    pendingImageUri,
    setPendingImageUri,
    pendingImageDims,
    setPendingImageDims,
    activeSlotIndex,
    setActiveSlotIndex,
    pickImage,
    handleCropComplete,
    removeImage,
    cleanupCache,
  };
}
