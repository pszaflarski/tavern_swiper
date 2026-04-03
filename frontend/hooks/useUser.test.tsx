import { renderHook, waitFor } from '@testing-library/react-native';
import { useUser } from './useUser';
import { usersApi } from '../lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import MockAdapter from 'axios-mock-adapter';

// Mock Firebase & Auth via a single source
jest.mock('../lib/firebase', () => ({
  auth: {
    currentUser: {
      uid: 'test-123',
      email: 'test@example.com',
      getIdToken: jest.fn(() => Promise.resolve('test-token')),
    },
  },
}));

jest.mock('@firebase/auth', () => ({
  onAuthStateChanged: jest.fn((_auth: any, callback: (user: any) => void) => {
    callback({
      uid: 'test-123',
      email: 'test@example.com',
      getIdToken: jest.fn(() => Promise.resolve('test-token')),
    });
    return () => {}; // unsubscribe
  }),
}));


const mockUsersApi = new MockAdapter(usersApi);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: 0,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useUser Hook', () => {
  beforeEach(() => {
    mockUsersApi.reset();
    jest.clearAllMocks();
  });

  it('fetches existing user metadata', async () => {
    mockUsersApi.onGet('/users/root-admin-exists').reply(200, { exists: true });
    mockUsersApi.onGet('/users/me').reply(200, {
      uid: 'test-123',
      email: 'test@example.com',
      is_premium: true,
      created_at: new Date().toISOString(),
    });

    const { result } = renderHook(() => useUser(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user?.uid).toBe('test-123');
    expect(result.current.user?.is_premium).toBe(true);
  });

  it('automatically registers user if not found (404)', async () => {
    mockUsersApi.onGet('/users/root-admin-exists').reply(200, { exists: true });
    mockUsersApi.onGet('/users/me').reply(404);
    mockUsersApi.onPost('/users/').reply(200, {
      uid: 'test-123',
      email: 'test@example.com',
      is_premium: false,
      created_at: new Date().toISOString(),
    });

    const { result } = renderHook(() => useUser(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.user?.uid).toBe('test-123'));
  });
});

