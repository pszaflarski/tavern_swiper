import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useUser } from '../../hooks/useUser';
import { auth } from '../../lib/firebase';
import { clearTavernSession } from '../../lib/api';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AuthProvider } from '../../context/AuthContext';
import React from 'react';

// Mock dependencies
jest.mock('../../lib/firebase', () => ({
  auth: {
    signOut: jest.fn().mockResolvedValue(undefined),
    currentUser: { uid: 'test-uid' },
    onAuthStateChanged: jest.fn((auth, callback) => {
      // Simulate initialized state
      callback({ uid: 'test-uid' });
      return jest.fn(); // unsubscribe
    }),
  },
}));

jest.mock('../../lib/api', () => ({
  usersApi: {
    get: jest.fn().mockResolvedValue({ data: { uid: 'test-uid' } }),
  },
  clearTavernSession: jest.fn().mockResolvedValue(undefined),
  getPersistedUid: jest.fn().mockResolvedValue('test-uid'),
}));

describe('Logout Integration', () => {
  let queryClient: QueryClient;

  const createWrapper = (client: QueryClient) => ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthProvider>
  );

  beforeEach(() => {
    jest.useRealTimers();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    (useQueryClient as jest.Mock).mockReturnValue(queryClient);
    jest.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('should clear both Firebase session and Tavern session on logout', async () => {
    const { result } = renderHook(() => useUser(), { 
      wrapper: createWrapper(queryClient) 
    });

    // Wait for initial hydration (isAuthenticated should become true)
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.logout();
    });

    // 1. Verify Firebase signOut was called
    expect(auth.signOut).toHaveBeenCalledTimes(1);

    // 2. Verify Tavern session was cleared (JWT + UID in storage)
    expect(clearTavernSession).toHaveBeenCalledTimes(1);

    // 3. Verify internal state was reset
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.uid).toBe(null);
    expect(result.current.user).toBe(null);
  });
});
