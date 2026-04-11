import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AuthScreen from '../app/auth';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useUser } from '../hooks/useUser';

// Mock axios since it causes stream issues in RN/Jest env
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    post: jest.fn(() => Promise.resolve({ data: {} })),
    get: jest.fn(() => Promise.resolve({ data: {} })),
  })),
  post: jest.fn(() => Promise.resolve({ data: {} })),
  get: jest.fn(() => Promise.resolve({ data: {} })),
}));

// Mock high-level hooks
jest.mock('../hooks/useUser', () => ({
  useUser: jest.fn(),
}));

// Mock firebase
jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
}));

// Mock lib/firebase
jest.mock('../lib/firebase', () => ({
  auth: { currentUser: null },
}));

describe('Login Screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    (useUser as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      uid: null,
      refetch: jest.fn(),
      logout: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders login screen by default', () => {
    const { getByTestId, getByText } = render(<AuthScreen />);
    expect(getByText('Sign In')).toBeTruthy();
    expect(getByTestId('auth-email-input')).toBeTruthy();
    expect(getByTestId('auth-password-input')).toBeTruthy();
  });

  it('shows error message on failed login', async () => {
    (signInWithEmailAndPassword as jest.Mock).mockRejectedValueOnce({
      code: 'auth/wrong-password',
      message: 'Wrong password.',
    });

    const { getByTestId, findByText } = render(<AuthScreen />);
    
    fireEvent.changeText(getByTestId('auth-email-input'), 'peter@gmail.com');
    fireEvent.changeText(getByTestId('auth-password-input'), 'wrongpassword');
    fireEvent.press(getByTestId('auth-submit-button'));

    const errorText = await findByText('Wrong password. Please try again.');
    expect(errorText).toBeTruthy();
  });

  it('successfully logs in with valid credentials', async () => {
    (signInWithEmailAndPassword as jest.Mock).mockResolvedValueOnce({
      user: { email: 'peter@gmail.com' },
    });

    const { getByTestId } = render(<AuthScreen />);
    
    fireEvent.changeText(getByTestId('auth-email-input'), 'peter@gmail.com');
    fireEvent.changeText(getByTestId('auth-password-input'), 'Password123!');
    fireEvent.press(getByTestId('auth-submit-button'));

    await waitFor(() => {
      expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
        expect.any(Object),
        'peter@gmail.com',
        'Password123!'
      );
    });
  });

  it('toggles password visibility', () => {
    const { getByTestId } = render(<AuthScreen />);
    const passwordInput = getByTestId('auth-password-input');
    const toggleButton = getByTestId('auth-password-toggle');

    expect(passwordInput.props.secureTextEntry).toBe(true);
    fireEvent.press(toggleButton);
    expect(passwordInput.props.secureTextEntry).toBe(false);
  });
});
