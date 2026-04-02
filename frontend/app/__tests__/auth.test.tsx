import { NativeModules } from 'react-native';
// Patch NativeModules to prevent jest-expo from crashing on undefined ImageLoader
if (!NativeModules.ImageLoader) {
  NativeModules.ImageLoader = {
    prefetchImage: jest.fn(),
    getSize: jest.fn(),
  };
}
if (!NativeModules.ImageViewManager) {
  NativeModules.ImageViewManager = {};
}

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AuthScreen from '../auth';
import { signInWithEmailAndPassword } from '@firebase/auth';

// Mock Firebase & Auth via a single source (as seen in existing tests)
jest.mock('../../lib/firebase', () => ({
  auth: {
    currentUser: null,
  },
}));

jest.mock('@firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  onAuthStateChanged: jest.fn((_auth: any, callback: (user: any) => void) => {
    return () => {}; // unsubscribe
  }),
  getAuth: jest.fn(() => ({})),
}));

// Mock Ionicons as a functional component
jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, size, color, testID }: any) => {
    const React = require('react');
    const { Text } = require('react-native');
    return <Text testID={testID}>{`Ionicons-${name}`}</Text>;
  },
}));

describe('AuthScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('displays an error message when login fails', async () => {
    const mockError = {
      code: 'auth/wrong-password',
      message: 'Firebase: Error (auth/wrong-password).',
    };
    (signInWithEmailAndPassword as jest.Mock).mockRejectedValueOnce(mockError);

    const { getByTestId, findByText } = render(<AuthScreen />);

    fireEvent.changeText(getByTestId('auth-email-input'), 'test@example.com');
    fireEvent.changeText(getByTestId('auth-password-input'), 'wrongpassword');
    fireEvent.press(getByTestId('auth-submit-button'));

    const errorText = await findByText('Wrong password. Please try again.');
    expect(errorText).toBeTruthy();
  });

  it('toggles password visibility when eye icon is pressed', () => {
    const { getByTestId } = render(<AuthScreen />);
    const passwordInput = getByTestId('auth-password-input');
    const toggleButton = getByTestId('auth-password-toggle');

    // Initially hidden
    expect(passwordInput.props.secureTextEntry).toBe(true);

    // Toggle to visible
    fireEvent.press(toggleButton);
    expect(passwordInput.props.secureTextEntry).toBe(false);

    // Toggle back to hidden
    fireEvent.press(toggleButton);
    expect(passwordInput.props.secureTextEntry).toBe(true);
  });

  it('clears error message when user starts typing again', async () => {
    const mockError = { code: 'auth/wrong-password', message: 'Error' };
    (signInWithEmailAndPassword as jest.Mock).mockRejectedValueOnce(mockError);

    const { getByTestId, queryByTestId, findByText } = render(<AuthScreen />);

    fireEvent.changeText(getByTestId('auth-email-input'), 'test@example.com');
    fireEvent.changeText(getByTestId('auth-password-input'), 'wrong');
    fireEvent.press(getByTestId('auth-submit-button'));

    await findByText('Wrong password. Please try again.');

    // Start typing in email
    fireEvent.changeText(getByTestId('auth-email-input'), 'test2@example.com');
    expect(queryByTestId('auth-error-text')).toBeNull();
  });
});
