/**
 * imageProcessing.ts — Web-native port of Tavern Swiper's image pipeline.
 *
 * Replicates the exact same crop → resize → compress pipeline from
 * frontend/lib/imageProcessing.ts, but uses the Canvas API instead
 * of expo-image-manipulator.
 *
 * Target spec: 1080×1350px, JPEG, 75% quality.
 */

export const TARGET_WIDTH = 1080;
export const TARGET_HEIGHT = 1350;
export const JPEG_QUALITY = 0.75;
export const ASPECT_RATIO = 4 / 5; // 1080/1350

export interface CropData {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Map visual transformation (pan/zoom) back to the natural image pixel space.
 *
 * This is a direct copy of the RN version — pure math, no platform deps.
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
 * Load an image from a URL/blob/data URI into an HTMLImageElement.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

/** Max dimension (longest side) for images entering the cropper.
 *  2× the 1080 target width — enough quality, small enough to
 *  keep the cropper math accurate across platforms.              */
const MAX_CROPPER_DIM = 2160;

/**
 * Preprocess a raw image before it enters the cropper.
 *
 * 1. Draws through Canvas, which bakes in any browser-applied EXIF rotation.
 * 2. Downsizes to MAX_CROPPER_DIM on the longest side if oversized.
 * 3. Does NOT crop — that's the cropper's job.
 *
 * Returns { url, width, height } for the preprocessed image.
 */
export async function preprocessForCropper(
  src: string
): Promise<{ url: string; width: number; height: number }> {
  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const longest = Math.max(w, h);

  let outW = w;
  let outH = h;

  if (longest > MAX_CROPPER_DIM) {
    const scale = MAX_CROPPER_DIM / longest;
    outW = Math.round(w * scale);
    outH = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, outW, outH);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed.'))),
      'image/jpeg',
      0.95 // near-lossless; final compression happens in processProfileAsset
    );
  });

  const url = URL.createObjectURL(blob);
  return { url, width: outW, height: outH };
}

/**
 * Normalizes user-selected imagery to the project's canonical profile specification.
 * Target: 1080×1350px, JPEG, 75% Quality.
 *
 * Pipeline: crop (optional) → resize → compress → blob URL
 */
export async function processProfileAsset(
  imageElement: HTMLImageElement,
  cropData?: CropData
): Promise<{ url: string; blob: Blob; width: number; height: number }> {
  const canvas = document.createElement('canvas');
  canvas.width = TARGET_WIDTH;
  canvas.height = TARGET_HEIGHT;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  // Source coordinates (what to read from the source image)
  const sx = cropData?.x ?? 0;
  const sy = cropData?.y ?? 0;
  const sw = cropData?.width ?? imageElement.naturalWidth;
  const sh = cropData?.height ?? imageElement.naturalHeight;

  // Draw the cropped region scaled to the target resolution
  ctx.drawImage(imageElement, sx, sy, sw, sh, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);

  // Compress to JPEG at 75% quality
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed.'))),
      'image/jpeg',
      JPEG_QUALITY
    );
  });

  const url = URL.createObjectURL(blob);
  return { url, blob, width: TARGET_WIDTH, height: TARGET_HEIGHT };
}

/**
 * Format byte count to human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
