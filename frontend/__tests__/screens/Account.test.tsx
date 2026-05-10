import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import AccountScreen from '../../screens/AccountScreen';
import { auth } from '../../lib/firebase';

// Mock firebase
jest.mock('../../lib/firebase', () => ({
  auth: {
    signOut: jest.fn(),
  },
}));

// Mock useUser
jest.mock('../../hooks/useUser', () => ({
  useUser: jest.fn(),
}));

import { useUser } from '../../hooks/useUser';

describe('Account Screen', () => {
  const mockLogout = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useUser as jest.Mock).mockReturnValue({
      logout: mockLogout,
      refetch: jest.fn(),
    });
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
    
    expect(mockLogout).toHaveBeenCalled();
  });
});
