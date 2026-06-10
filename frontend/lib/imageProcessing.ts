import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

/** Target profile image dimensions */
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1350;

/**
 * Preprocess a raw camera/gallery image before it enters the cropper.
 *
 * Resizes the image so it exactly matches the target profile dimensions
 * on at least one axis (1080 wide or 1350 tall). The cropper then only
 * needs to trim the overflow on the other axis.
 *
 * - Landscape/wide images → height = 1350, width > 1080 (crop sides)
 * - Portrait/tall images  → width = 1080, height > 1350 (crop top/bottom)
 * - Bakes in EXIF orientation (manipulateAsync auto-applies it).
 * - Does NOT crop — that's the cropper's job.
 */
export interface PreprocessResult {
  uri: string;
  width: number;
  height: number;
}

export async function preprocessForCropper(uri: string): Promise<PreprocessResult> {
  // Use manipulateAsync to get original dimensions — Image.getSize can return
  // downsampled values on Android (Fresco pipeline), while manipulateAsync uses
  // Glide which loads full-resolution bitmaps.
  const probe = await manipulateAsync(uri, [], {
    compress: 1,
    format: SaveFormat.JPEG,
  });
  const width = probe.width;
  const height = probe.height;


  const imageRatio = width / height;
  const targetRatio = TARGET_WIDTH / TARGET_HEIGHT; // 0.8

  const actions: any[] = [];

  if (imageRatio > targetRatio) {
    // Wider than 4:5 — fit height to 1350, width will exceed 1080
    actions.push({ resize: { height: TARGET_HEIGHT } });
  } else {
    // Taller than 4:5 — fit width to 1080, height will exceed 1350
    actions.push({ resize: { width: TARGET_WIDTH } });
  }

  const result = await manipulateAsync(uri, actions, {
    compress: 1, // lossless at this stage; the cropper pipeline compresses later
    format: SaveFormat.JPEG,
  });


  return { uri: result.uri, width: result.width, height: result.height };
}

export interface CropData {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Map visual transformation (pan/zoom) back to the natural image pixel space.
 * 
 * imageDim and apertureDim must be in the SAME coordinate space used by the
 * cropper's gesture system. Since the cropper sets the Animated.Image style
 * dimensions to `imageDim` and the aperture to `apertureDim` (both in dp),
 * all values here are in dp and no pixel-ratio conversion is needed.
 *
 * @param imageDim Natural dimensions of the source image (must match what the cropper uses)
 * @param apertureDim Dimensions of the 4:5 viewing portal (dp / UI space)
 * @param scale Total zoom applied by user (unitless ratio: aperture / imageDim)
 * @param translateX Horizontal offset in dp / UI space
 * @param translateY Vertical offset in dp / UI space
 */
export function calculateTransformCrop(
  imageDim: { width: number; height: number },
  apertureDim: { width: number; height: number },
  scale: number,
  translateX: number,
  translateY: number,
): CropData {
  // 1. Calculate the 'natural' size of the viewing portal in image-dim units
  const awNatural = apertureDim.width / scale;
  const ahNatural = apertureDim.height / scale;

  // 2. Calculate offsets in image-dim units
  const offsetX = -translateX / scale;
  const offsetY = -translateY / scale;

  // 3. Project the center-relative offsets back to the image origin (top-left)
  const x = (imageDim.width - awNatural) / 2 + offsetX;
  const y = (imageDim.height - ahNatural) / 2 + offsetY;

  // 4. Clamp crop rectangle within image bounds
  const clampedW = Math.min(Math.round(awNatural), imageDim.width);
  const clampedH = Math.min(Math.round(ahNatural), imageDim.height);
  const clampedX = Math.max(0, Math.min(Math.round(x), imageDim.width - clampedW));
  const clampedY = Math.max(0, Math.min(Math.round(y), imageDim.height - clampedH));

  return {
    x: clampedX,
    y: clampedY,
    width: clampedW,
    height: clampedH,
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
