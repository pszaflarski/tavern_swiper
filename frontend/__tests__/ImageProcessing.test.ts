import { processProfileAsset, prepareImageUpload } from '../lib/imageProcessing';
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
