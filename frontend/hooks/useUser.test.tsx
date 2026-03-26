import { renderHook, waitFor } from '@testing-library/react-native';
import { useUser } from './useUser';
import { usersApi } from '../lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import MockAdapter from 'axios-mock-adapter';

// Mock Firebase
jest.mock('../lib/firebase', () => ({
  auth: {
    currentUser: { 
      uid: 'test-123', 
      email: 'test@example.com',
      getIdToken: jest.fn(() => Promise.resolve('test-token')),
    },
  },
}));

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn((authInstance, cb) => {
    cb({ uid: 'test-123', email: 'test@example.com' });
    return () => {};
  }),
}));

const mockUsersApi = new MockAdapter(usersApi);

const queryClient = new QueryClient({
  defaultOptions: { 
    queries: { 
      retry: false,
      gcTime: 0, 
      staleTime: 0,
    } 
  },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

describe('useUser Hook', () => {
  beforeEach(() => {
    queryClient.clear();
    mockUsersApi.reset();
    jest.clearAllMocks();
  });

  afterAll(() => {
    queryClient.clear();
  });

  it('fetches existing user metadata', async () => {
    mockUsersApi.onGet('/users/me').reply(200, {
      uid: 'test-123', email: 'test@example.com', is_premium: true
    });

    const { result } = renderHook(() => useUser(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.user?.uid).toBe('test-123');
    expect(result.current.user?.is_premium).toBe(true);
  });

  it('automatically registers user if not found (404)', async () => {
    mockUsersApi.onGet('/users/me').reply(404);
    mockUsersApi.onPost('/users/').reply(200, {
      uid: 'test-123', email: 'test@example.com', is_premium: false
    });

    const { result } = renderHook(() => useUser(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.user?.uid).toBe('test-123'));
  });
});
