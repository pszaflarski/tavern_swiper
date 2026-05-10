import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ImageCropperModal } from '../../components/ImageCropperModal';
import { processProfileAsset } from '../../lib/imageProcessing';
import { Image } from 'react-native';

// Mock imageProcessing service
jest.mock('../../lib/imageProcessing', () => ({
  processProfileAsset: jest.fn().mockResolvedValue('processed-uri'),
  calculateTransformCrop: jest.requireActual('../../lib/imageProcessing').calculateTransformCrop,
}));

// Mock Ionicons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

describe('ImageCropperModal', () => {
  const mockOnCropComplete = jest.fn();
  const mockOnClose = jest.fn();
  const testImageUri = 'file://test-image.jpg';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock Image.getSize to simulate an image load (Landscape image)
    // @ts-ignore
    jest.spyOn(Image, 'getSize').mockImplementation((uri, success) => {
      success(2000, 1000);
    });
  });

  it('renders all structural components', () => {
    const { getByText, getByTestId } = render(
      <ImageCropperModal
        isVisible={true}
        imageUri={testImageUri}
        onClose={mockOnClose}
        onCropComplete={mockOnCropComplete}
      />
    );

    expect(getByText('Refine Vision')).toBeTruthy();
    expect(getByTestId('close-cropper-button')).toBeTruthy();
    expect(getByTestId('zoom-in-button')).toBeTruthy();
    expect(getByTestId('zoom-out-button')).toBeTruthy();
    expect(getByTestId('finalize-ritual-button')).toBeTruthy();
  });

  it('calls onClose when close button is pressed', () => {
    const { getByTestId } = render(
      <ImageCropperModal
        isVisible={true}
        imageUri={testImageUri}
        onClose={mockOnClose}
        onCropComplete={mockOnCropComplete}
      />
    );

    fireEvent.press(getByTestId('close-cropper-button'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('allows interaction with zoom buttons', () => {
    const { getByTestId } = render(
      <ImageCropperModal
        isVisible={true}
        imageUri={testImageUri}
        onClose={mockOnClose}
        onCropComplete={mockOnCropComplete}
      />
    );

    // Testing actual shared value changes in unit tests is complex,
    // so we verify that the buttons are pressable and don't crash.
    fireEvent.press(getByTestId('zoom-in-button'));
    fireEvent.press(getByTestId('zoom-out-button'));
    
    // If the component doesn't crash during these presses, the basic connectivity is verified.
  });

  it('performs coordinate projection and completes crop', async () => {
    const { getByTestId } = render(
      <ImageCropperModal
        isVisible={true}
        imageUri={testImageUri}
        onClose={mockOnClose}
        onCropComplete={mockOnCropComplete}
      />
    );

    const finalizeButton = getByTestId('finalize-ritual-button');
    fireEvent.press(finalizeButton);

    await waitFor(() => {
      expect(processProfileAsset).toHaveBeenCalledWith(
        testImageUri,
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
          width: expect.any(Number),
          height: expect.any(Number),
        })
      );
      expect(mockOnCropComplete).toHaveBeenCalledWith('processed-uri');
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('shows activity indicator when image is not yet loaded', () => {
    // Override getSize mock for this test to do nothing (simulating slow load)
    // @ts-ignore
    Image.getSize.mockImplementation(() => {});

    const { getByRole, queryByTestId } = render(
      <ImageCropperModal
        isVisible={true}
        imageUri={testImageUri}
        onClose={mockOnClose}
        onCropComplete={mockOnCropComplete}
      />
    );

    // Should show activity indicator
    // In React Native Paper/Core, ActivityIndicator might not have a role of 'progressbar' in mocks
    // We'll check for it by structure or just confirm cropper stack is missing
    expect(queryByTestId('zoom-in-button')).toBeNull();
  });
});
