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
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from '@firebase/auth';
import { usersApi } from '../../lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Mock Firebase & Auth via a single source (as seen in existing tests)
jest.mock('../../hooks/useUser', () => ({
  useUser: jest.fn(() => ({
    isAuthenticated: false,
    isLoading: false,
    user: null,
    rootExists: true,
  })),
}));

jest.mock('../../lib/api', () => ({
  usersApi: {
    post: jest.fn(),
    get: jest.fn(),
  },
}));

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

    const { getByTestId, findByText } = render(<AuthScreen />, { wrapper: createWrapper() });

    fireEvent.changeText(getByTestId('auth-email-input'), 'test@example.com');
    fireEvent.changeText(getByTestId('auth-password-input'), 'wrongpassword');
    fireEvent.press(getByTestId('auth-submit-button'));

    const errorText = await findByText('Wrong password. Please try again.');
    expect(errorText).toBeTruthy();
  });

  it('toggles password visibility when eye icon is pressed', () => {
    const { getByTestId } = render(<AuthScreen />, { wrapper: createWrapper() });
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

    const { getByTestId, queryByTestId, findByText } = render(<AuthScreen />, { wrapper: createWrapper() });

    fireEvent.changeText(getByTestId('auth-email-input'), 'test@example.com');
    fireEvent.changeText(getByTestId('auth-password-input'), 'wrong');
    fireEvent.press(getByTestId('auth-submit-button'));

    await findByText('Wrong password. Please try again.');

    // Start typing in email
    fireEvent.changeText(getByTestId('auth-email-input'), 'test2@example.com');
    expect(queryByTestId('auth-error-text')).toBeNull();
  });

  it('toggles between Sign In and Sign Up modes', () => {
    const { getByTestId, getByText, queryByText } = render(<AuthScreen />, { wrapper: createWrapper() });

    // Initial state: Sign In
    expect(getByText('Sign In')).toBeTruthy();
    expect(getByText('Enter Tavern')).toBeTruthy();

    // Toggle to Sign Up
    fireEvent.press(getByTestId('auth-toggle-link'));
    expect(getByText('Begin Your Quest')).toBeTruthy();
    expect(getByText('Claim Your Title')).toBeTruthy();

    // Toggle back to Sign In
    fireEvent.press(getByTestId('auth-toggle-link'));
    expect(getByText('Sign In')).toBeTruthy();
  });

  it('shows error when fields are empty', async () => {
    const { getByTestId, findByText } = render(<AuthScreen />, { wrapper: createWrapper() });

    fireEvent.press(getByTestId('auth-submit-button'));

    const errorText = await findByText('Please fill in all fields.');
    expect(errorText).toBeTruthy();
  });

  it('successfully signs up a user and creates backend record', async () => {
    const mockUser = { user: { email: 'new@example.com', uid: 'new-uid-456' } };
    (createUserWithEmailAndPassword as jest.Mock).mockResolvedValueOnce(mockUser);
    (usersApi.post as jest.Mock).mockResolvedValueOnce({ data: { success: true } });

    const { getByTestId } = render(<AuthScreen />, { wrapper: createWrapper() });

    // Switch to signup mode
    fireEvent.press(getByTestId('auth-toggle-link'));

    fireEvent.changeText(getByTestId('auth-email-input'), 'new@example.com');
    fireEvent.changeText(getByTestId('auth-password-input'), 'password123');
    fireEvent.press(getByTestId('auth-submit-button'));

    await waitFor(() => {
      expect(createUserWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), 'new@example.com', 'password123');
      expect(usersApi.post).toHaveBeenCalledWith('/users/', {
        email: 'new@example.com',
        user_type: 'user',
        is_premium: false,
      });
    });
  });
});
