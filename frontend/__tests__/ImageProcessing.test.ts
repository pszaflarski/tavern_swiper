import { processProfileAsset, prepareImageUpload, calculateTransformCrop } from '../lib/imageProcessing';
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
    expect(result.name).toContain('standardized_profile_0');
    expect(result.type).toBe('image/jpeg');
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
