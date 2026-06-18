import { processProfileAsset, prepareImageUpload, calculateTransformCrop } from '../../lib/imageProcessing';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';

// Mock expo-image-manipulator
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: {
    JPEG: 'jpeg',
  },
}));

// Mock fetch for uriToBlob
global.fetch = jest.fn(() =>
  Promise.resolve({
    blob: () => Promise.resolve(new Blob(['fake image data'], { type: 'image/jpeg' })),
  })
) as jest.Mock;

describe('ImageProcessing Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateTransformCrop Math', () => {
    const imageDim = { width: 2000, height: 1000 }; // 2:1 landscape
    const apertureDim = { width: 400, height: 500 }; // 4:5 fixed portal

    it('calculates correct crop for centered initial fit (cover)', () => {
      // For a 2000x1000 image and 400x500 aperture:
      // minScale to cover 500 height is 500/1000 = 0.5.
      const scale = 0.5;
      const tx = 0;
      const ty = 0;

      const result = calculateTransformCrop(imageDim, apertureDim, scale, tx, ty);

      // awNatural = 400 / 0.5 = 800
      // ahNatural = 500 / 0.5 = 1000
      // x = (2000 - 800) / 2 = 600
      // y = (1000 - 1000) / 2 = 0
      expect(result).toEqual({
        x: 600,
        y: 0,
        width: 800,
        height: 1000,
      });
    });

    it('calculates correct crop after panning left', () => {
      const scale = 0.5;
      const tx = -50; // Panned 50px visual units left
      const ty = 0;

      const result = calculateTransformCrop(imageDim, apertureDim, scale, tx, ty);

      // offsetX = -(-50) / 0.5 = 100
      // x = 600 + 100 = 700
      expect(result.x).toBe(700);
      expect(result.width).toBe(800);
    });

    it('calculates correct crop after zooming in 2x', () => {
      const scale = 1.0; // 2x the 0.5 minScale
      const tx = 0;
      const ty = 0;

      const result = calculateTransformCrop(imageDim, apertureDim, scale, tx, ty);

      // awNatural = 400 / 1.0 = 400
      // ahNatural = 500 / 1.0 = 500
      // x = (2000 - 400) / 2 = 800
      // y = (1000 - 500) / 2 = 250
      expect(result).toEqual({
        x: 800,
        y: 250,
        width: 400,
        height: 500,
      });
    });
  });

  describe('calculateTransformCrop with Android pixelRatio', () => {
    // Simulate a typical Android camera photo (4032x3024) on a 3x device
    // The aperture is ~324dp wide, ~405dp tall (4:5 ratio)
    const imageDim = { width: 4032, height: 3024 }; // physical pixels
    const apertureDim = { width: 324, height: 405 }; // dp
    const pixelRatio = 3;

    it('produces correct centered crop on 3x Android device', () => {
      // Initial minScale = max(324/4032, 405/3024) = max(0.0804, 0.1339) = 0.1339
      const scale = Math.max(apertureDim.width / imageDim.width, apertureDim.height / imageDim.height);
      const tx = 0;
      const ty = 0;

      const result = calculateTransformCrop(imageDim, apertureDim, scale, tx, ty, pixelRatio);

      // effectiveScale = 0.1339 * 3 = 0.4018
      // apertureW_px = 324 * 3 = 972
      // apertureH_px = 405 * 3 = 1215
      // awNatural = 972 / 0.4018 = ~2419
      // ahNatural = 1215 / 0.4018 = ~3024 (should fill height)
      // x = (4032 - 2419) / 2 = ~807
      // y = (3024 - 3024) / 2 = 0
      expect(result.y).toBe(0); // Image height matches — no vertical offset
      expect(result.x).toBeGreaterThan(0); // Centered horizontally
      expect(result.height).toBe(imageDim.height); // Full image height used
      expect(result.width).toBeLessThan(imageDim.width); // Cropped horizontally
    });

    it('produces same results as pixelRatio=1 when inputs are already in pixels', () => {
      // If we manually pre-multiply aperture into pixels and pass pixelRatio=1,
      // we should get the same result as passing dp values with pixelRatio=3
      const scale = 0.1339;
      const tx = 10; // dp
      const ty = 5;

      const resultWithRatio = calculateTransformCrop(
        imageDim, apertureDim, scale, tx, ty, pixelRatio
      );
      const resultManual = calculateTransformCrop(
        imageDim,
        { width: apertureDim.width * pixelRatio, height: apertureDim.height * pixelRatio },
        scale * pixelRatio,
        tx * pixelRatio,
        ty * pixelRatio,
        1
      );

      expect(resultWithRatio).toEqual(resultManual);
    });

    it('handles panning on high-DPI Android correctly', () => {
      const scale = 0.1339;
      const tx = -30; // panned 30dp left (user gesture in dp)
      const ty = 0;

      const result = calculateTransformCrop(imageDim, apertureDim, scale, tx, ty, pixelRatio);

      // offsetX = -(-30 * 3) / (0.1339 * 3) = 90 / 0.4018 = ~224px to the right
      // Crop should shift right compared to centered
      const centeredResult = calculateTransformCrop(imageDim, apertureDim, scale, 0, 0, pixelRatio);
      expect(result.x).toBeGreaterThan(centeredResult.x);
      expect(result.width).toBe(centeredResult.width); // Width unchanged by pan
    });

    it('clamps crop within image bounds', () => {
      // Very low scale → crop region larger than image
      const scale = 0.01;
      const result = calculateTransformCrop(imageDim, apertureDim, scale, 0, 0, pixelRatio);

      expect(result.width).toBeLessThanOrEqual(imageDim.width);
      expect(result.height).toBeLessThanOrEqual(imageDim.height);
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeGreaterThanOrEqual(0);
    });
  });

  it('processProfileAsset should call manipulateAsync with correct parameters', async () => {
    const mockUri = 'file://test-image.jpg';
    const mockCrop = { x: 10, y: 20, width: 100, height: 100 };
    const mockResultUri = 'file://processed-image.jpg';

    (ImageManipulator.manipulateAsync as jest.Mock).mockResolvedValue({
      uri: mockResultUri,
    });

    const result = await processProfileAsset(mockUri, mockCrop);

    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      mockUri,
      [
        { crop: { originX: 10, originY: 20, width: 100, height: 100 } },
        { resize: { width: 1080, height: 1350 } },
      ],
      {
        compress: 0.75,
        format: 'jpeg',
      }
    );
    expect(result).toBe(mockResultUri);
  });

  it('processProfileAsset should handle missing crop data by only resizing', async () => {
    const mockUri = 'file://test-image.jpg';
    const mockResultUri = 'file://processed-image.jpg';

    (ImageManipulator.manipulateAsync as jest.Mock).mockResolvedValue({
      uri: mockResultUri,
    });

    const result = await processProfileAsset(mockUri);

    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      mockUri,
      [
        { resize: { width: 1080, height: 1350 } },
      ],
      {
        compress: 0.75,
        format: 'jpeg',
      }
    );
    expect(result).toBe(mockResultUri);
  });

  it('prepareImageUpload should return a File object on Web', async () => {
    // Mock Platform.OS
    // @ts-ignore
    Platform.OS = 'web';

    const processedUri = 'blob:http://localhost/123';
    const index = 0;

    const result = await prepareImageUpload(processedUri, index);

    expect(result).toBeInstanceOf(File);
    expect((result as File).name).toContain('standardized_profile_0');
    expect((result as File).type).toBe('image/jpeg');
  });

  it('prepareImageUpload should return a special object on Native', async () => {
    // Mock Platform.OS
    // @ts-ignore
    Platform.OS = 'ios';

    const processedUri = 'file://processed-image.jpg';
    const index = 1;

    const result = await prepareImageUpload(processedUri, index);

    expect(result).toEqual(expect.objectContaining({
      uri: processedUri,
      type: 'image/jpeg',
      name: expect.stringContaining('standardized_profile_1'),
    }));
  });
});
