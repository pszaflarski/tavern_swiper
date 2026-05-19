import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { useUnreadStatus } from '../../hooks/useUnreadStatus';
import { useProfileContext } from '../../context/ProfileContext';
import { messagesApi } from '../../lib/api';

// Mock ProfileContext
jest.mock('../../context/ProfileContext', () => ({
  useProfileContext: jest.fn(),
}));

// Mock the API layer — useQueries stays real, we mock the network
jest.mock('../../lib/api', () => ({
  messagesApi: {
    get: jest.fn(),
  },
}));

// Route React Query notifications through act() to prevent warnings.
// Set once at module scope so it covers all lifecycle phases including cleanup.
notifyManager.setNotifyFunction((fn) => {
  act(() => { fn(); });
});

// Shared QueryClient instance, recreated per test
let queryClient: QueryClient;

function createWrapper() {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useUnreadStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('should return false/empty when user has no profiles', () => {
    (useProfileContext as jest.Mock).mockReturnValue({ profiles: [] });

    const { result } = renderHook(() => useUnreadStatus(), {
      wrapper: createWrapper(),
    });

    expect(result.current.hasAnyUnread).toBe(false);
    expect(result.current.unreadByProfile).toEqual({});
    // No API calls should be made when there are no profiles
    expect(messagesApi.get).not.toHaveBeenCalled();
  });

  it('should detect unread conversations per profile', async () => {
    (useProfileContext as jest.Mock).mockReturnValue({
      profiles: [{ profile_id: 'p1' }, { profile_id: 'p2' }],
    });

    // p1 has an unread conversation, p2 does not
    (messagesApi.get as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('p1')) {
        return Promise.resolve({
          data: [
            { id: 'c1', unread: true },
            { id: 'c2', unread: false },
          ],
        });
      }
      if (url.includes('p2')) {
        return Promise.resolve({
          data: [{ id: 'c3', unread: false }],
        });
      }
      return Promise.resolve({ data: [] });
    });

    const { result } = renderHook(() => useUnreadStatus(), {
      wrapper: createWrapper(),
    });

    // Wait for queries to settle inside act()
    await waitFor(() => {
      expect(result.current.hasAnyUnread).toBe(true);
    });

    expect(result.current.unreadByProfile['p1']).toBe(true);
    expect(result.current.unreadByProfile['p2']).toBe(false);
  });

  it('should return all false when no conversations are unread', async () => {
    (useProfileContext as jest.Mock).mockReturnValue({
      profiles: [{ profile_id: 'p1' }, { profile_id: 'p2' }],
    });

    (messagesApi.get as jest.Mock).mockResolvedValue({
      data: [{ id: 'c1', unread: false }],
    });

    const { result } = renderHook(() => useUnreadStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.unreadByProfile['p1']).toBe(false);
    });

    expect(result.current.hasAnyUnread).toBe(false);
    expect(result.current.unreadByProfile['p2']).toBe(false);
  });

  it('should handle missing unread field (backward compatibility)', async () => {
    (useProfileContext as jest.Mock).mockReturnValue({
      profiles: [{ profile_id: 'p1' }],
    });

    // Legacy conversation without the unread field
    (messagesApi.get as jest.Mock).mockResolvedValue({
      data: [{ id: 'c1' }],
    });

    const { result } = renderHook(() => useUnreadStatus(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.unreadByProfile['p1']).toBeDefined();
    });

    // Missing unread should default to false (not unread)
    expect(result.current.hasAnyUnread).toBe(false);
    expect(result.current.unreadByProfile['p1']).toBe(false);
  });
});
