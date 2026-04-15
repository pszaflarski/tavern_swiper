import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

export interface CropData {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Map visual transformation (pan/zoom) back to the natural image pixel space.
 * 
 * @param imageDim Natural dimensions of the source image
 * @param apertureDim Dimensions of the 4:5 viewing portal (UI space)
 * @param scale Total zoom applied by user (where 1.0 is the center-fit-cover scale)
 * @param translateX Horizontal offset in UI space
 * @param translateY Vertical offset in UI space
 */
export function calculateTransformCrop(
  imageDim: { width: number; height: number },
  apertureDim: { width: number; height: number },
  scale: number,
  translateX: number,
  translateY: number
): CropData {
  // 1. Calculate the 'natural' size of the viewing portal in image pixels
  const awNatural = apertureDim.width / scale;
  const ahNatural = apertureDim.height / scale;

  // 2. Calculate offsets in natural pixel space
  const offsetX = -translateX / scale;
  const offsetY = -translateY / scale;

  // 3. Project the center-relative offsets back to the image origin (top-left)
  const x = (imageDim.width - awNatural) / 2 + offsetX;
  const y = (imageDim.height - ahNatural) / 2 + offsetY;

  return {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.round(awNatural),
    height: Math.round(ahNatural),
  };
}

/**
 * Normalizes user-selected imagery to the project's canonical profile specification.
 * Target: 1080x1350px, JPEG, 75% Quality.
 * 
 * This service is used by both Web and Native platforms via Expo Image Manipulator.
 */
export const processProfileAsset = async (uri: string, cropData?: CropData) => {
  const actions = [];
  
  // 1. Precise Crop based on UI coordinates (if provided)
  if (cropData) {
    actions.push({
      crop: {
        originX: cropData.x,
        originY: cropData.y,
        width: cropData.width,
        height: cropData.height,
      },
    });
  }

  // 2. Geometric Scaling to final resolution (1080x1350)
  actions.push({
    resize: {
      width: 1080,
      height: 1350,
    },
  });

  try {
    const result = await manipulateAsync(
      uri,
      actions as any,
      {
        compress: 0.75,
        format: SaveFormat.JPEG,
      }
    );

    return result.uri;
  } catch (error) {
    console.error('Unified processing failed:', error);
    throw new Error('Alchemy failed: The image could not be transmuted into the required form.');
  }
};

/**
 * Converts a URI (Blob URL, Data URL, or File URI) to a Blob for network egress.
 */
export const uriToBlob = async (uri: string): Promise<Blob> => {
  // On Web, we can just use fetch. On Native, React Native's fetch handles file:// URIs.
  try {
    const response = await fetch(uri);
    return await response.blob();
  } catch (error) {
    console.error('Failed to convert URI to Blob:', error);
    throw new Error('Capture failed: The vision could not be materialized for transport.');
  }
};

/**
 * Preparer for FormData attachment.
 * Handles platform differences in Blob/File handling.
 */
export const prepareImageUpload = async (processedUri: string, index: number): Promise<File | Blob> => {
  const blob = await uriToBlob(processedUri);
  const filename = `standardized_profile_${index}_${Date.now()}.jpg`;

  if (Platform.OS === 'web') {
    // Standard File object for Web
    return new File([blob], filename, { type: 'image/jpeg' });
  } else {
    // On Native, we usually send the Uri directly in FormData with some metadata,
    // but building an object that looks like { uri, type, name } is the standard Expo/RN way.
    // However, our profilesApi uses axios which might handle Blobs differently on Native.
    // To be safe and unified, we'll return the blob if axios handles it, 
    // or return a "File-like" object if needed.
    
    // axios on RN typically expects: { uri, type, name } for multipart uploads.
    // Let's create that specific object.
    return {
      uri: processedUri,
      type: 'image/jpeg',
      name: filename,
    } as any;
  }
};
