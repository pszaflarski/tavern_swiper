import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AccountScreen from '../app/(tabs)/account';
import { auth } from '../lib/firebase';

// Mock firebase
jest.mock('../lib/firebase', () => ({
  auth: {
    signOut: jest.fn(),
  },
}));

describe('Account Screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders account screen', () => {
    const { getByText, getByTestId } = render(<AccountScreen />);
    expect(getByText('Account')).toBeTruthy();
    expect(getByTestId('logout-button')).toBeTruthy();
  });

  it('calls signOut on logout button press', async () => {
    const { getByTestId } = render(<AccountScreen />);
    const logoutBtn = getByTestId('logout-button');
    
    fireEvent.press(logoutBtn);
    
    expect(auth.signOut).toHaveBeenCalled();
  });
});
