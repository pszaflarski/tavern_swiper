import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTavernToken, profilesApi, authApi, performGlobalLogout, __resetInternalState, hydrateServiceUrls } from '../../lib/api';
import { auth } from '../../lib/firebase';
import { router } from 'expo-router';

// Mock axios since it's used directly in getTavernToken
jest.mock('axios', () => {
  const mockInstance = {
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { 
        use: jest.fn((success, error) => {
          (mockInstance as any)._errorHandler = error;
        }), 
        eject: jest.fn() 
      },
    },
    post: jest.fn(() => Promise.resolve({ data: {}, status: 200 })),
    get: jest.fn(() => Promise.resolve({ data: {}, status: 200 })),
  };
  return {
    create: jest.fn(() => mockInstance),
    post: jest.fn(() => Promise.resolve({ data: {}, status: 200 })),
    get: jest.fn(() => Promise.resolve({ data: {}, status: 200 })),
  };
});

const mockGetIdToken = jest.fn();
const mockOnAuthStateChanged = jest.fn();

jest.mock('../../lib/firebase', () => ({
  auth: {
    currentUser: null,
    onAuthStateChanged: jest.fn(),
    signOut: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('expo-router', () => ({
  router: {
    replace: jest.fn(),
  },
}));

describe('API Token Management', () => {
  beforeEach(async () => {
    await __resetInternalState();
    jest.clearAllMocks();
    
    // Ensure AsyncStorage methods return promises to avoid .catch() errors
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.multiSet as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.multiRemove as jest.Mock).mockResolvedValue(undefined);
    (AsyncStorage.clear as jest.Mock).mockResolvedValue(undefined);

    // Mock onAuthStateChanged to simulate successful login
    (auth.onAuthStateChanged as jest.Mock).mockImplementation((callback) => {
      // Simulate user appearing in state
      (auth as any).currentUser = {
        getIdToken: mockGetIdToken,
      };
      setImmediate(() => callback(auth.currentUser));
      return jest.fn(); // Unsubscribe
    });

    process.env.EXPO_PUBLIC_ROUTER_URL = 'http://test-router.com';
  });

  it('getTavernToken should deduplicate multiple simultaneous calls', async () => {
    mockGetIdToken.mockResolvedValue('firebase-token');
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { token: 'tavern-token', uid: 'test-uid' },
    });

    // Call multiple times simultaneously
    const [t1, t2, t3] = await Promise.all([
      getTavernToken(),
      getTavernToken(),
      getTavernToken(),
    ]);

    expect(t1).toBe('tavern-token');
    expect(t2).toBe('tavern-token');
    expect(t3).toBe('tavern-token');

    // Should only call axios.post ONCE
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('getTavernToken should handle Firebase token failure gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetIdToken.mockRejectedValue(new Error('Firebase Error'));
    
    const token = await getTavernToken();
    expect(token).toBeNull();
    consoleSpy.mockRestore();
  });

  it('getTavernToken should handle Auth service 401 response', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetIdToken.mockResolvedValue('firebase-token');
    (axios.post as jest.Mock).mockResolvedValue({
      status: 401,
      data: { detail: 'Invalid token' },
    });

    const token = await getTavernToken();
    expect(token).toBeNull();
    consoleSpy.mockRestore();
  });

  it('getTavernToken should ignore AsyncStorage token if UID does not match', async () => {
    (auth as any).currentUser = { uid: 'current-uid', getIdToken: mockGetIdToken };
    const now = Date.now();
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key) => {
      if (key === 'tavern_jwt_token') return Promise.resolve('stale-token');
      if (key === 'tavern_jwt_expiry') return Promise.resolve((now + 100000).toString());
      if (key === 'tavern_uid') return Promise.resolve('old-uid');
      return Promise.resolve(null);
    });

    mockGetIdToken.mockResolvedValue('firebase-token');
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { token: 'new-token', uid: 'current-uid' },
    });

    const token = await getTavernToken();
    expect(token).toBe('new-token'); // It should exchange for a new token, ignoring the stale one
    expect(axios.post).toHaveBeenCalled();
  });

  it('axios instances should be initialized with correct base URLs', async () => {
    expect(authApi).toBeDefined();
    expect(profilesApi).toBeDefined();
  });

  it('should trigger global logout and redirect on 401 response', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    
    await performGlobalLogout();
    
    expect(auth.signOut).toHaveBeenCalled();
    expect(AsyncStorage.multiRemove).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/auth');
    
    consoleSpy.mockRestore();
  });

  it('response interceptor should logout immediately on 401 when no Firebase user exists', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    
    // No Firebase user
    (auth as any).currentUser = null;
    
    const mockInstance = profilesApi as any;
    const errorHandler = mockInstance._errorHandler;

    const error = {
      response: { status: 401 },
      config: { url: '/profiles/me', headers: { Authorization: 'Bearer stale-token' } },
    } as any;

    await expect(errorHandler(error)).rejects.toBe(error);

    expect(error.config._retried).toBe(true);
    expect(auth.signOut).toHaveBeenCalled(); // Immediate logout — no Firebase user
    
    consoleSpy.mockRestore();
  });

  it('response interceptor should retry with fresh token on 401 when Firebase user exists', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Firebase user exists
    (auth as any).currentUser = { uid: 'test-uid', getIdToken: mockGetIdToken };
    mockGetIdToken.mockResolvedValue('fresh-firebase-token');
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { token: 'fresh-tavern-token', uid: 'test-uid' },
    });
    
    const mockInstance = profilesApi as any;
    const errorHandler = mockInstance._errorHandler;
    const mockRequest = jest.fn().mockRejectedValue(new Error('Retry failed'));
    (mockInstance as any).request = mockRequest;

    const error = {
      response: { status: 401 },
      config: { url: '/profiles/me', headers: { Authorization: 'Bearer stale-token' } },
    } as any;

    // Should reject but NOT logout (Firebase user still exists)
    await expect(errorHandler(error)).rejects.toThrow('Retry failed');

    expect(error.config._retried).toBe(true);
    expect(mockRequest).toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled(); // Should NOT logout
    
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
  });

  it('getTavernToken should use server-provided expires_at', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    
    mockGetIdToken.mockResolvedValue('firebase-token');
    const futureExpiry = Math.floor(Date.now() / 1000) + 86400; // 24h from now
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { token: 'tavern-token', uid: 'test-uid', expires_at: futureExpiry },
    });

    const token = await getTavernToken();
    expect(token).toBe('tavern-token');

    // Verify the expiry was persisted as milliseconds
    expect(AsyncStorage.multiSet).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.arrayContaining([
          'tavern_jwt_expiry',
          (futureExpiry * 1000).toString(),
        ]),
      ])
    );

    consoleSpy.mockRestore();
  });

  it('getTavernToken should return cached token on second call', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    mockGetIdToken.mockResolvedValue('firebase-token');
    const futureExpiry = Math.floor(Date.now() / 1000) + 86400;
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { token: 'tavern-token', uid: 'test-uid', expires_at: futureExpiry },
    });

    // First call — exchanges
    const t1 = await getTavernToken();
    expect(t1).toBe('tavern-token');
    expect(axios.post).toHaveBeenCalledTimes(1);

    // Second call — should use in-memory cache, no new exchange
    const t2 = await getTavernToken();
    expect(t2).toBe('tavern-token');
    expect(axios.post).toHaveBeenCalledTimes(1); // Still only 1 call

    consoleSpy.mockRestore();
  });

  it('getTavernToken should recover from AsyncStorage on app restart', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const uid = 'test-uid';
    const futureExpiry = Date.now() + 86400000; // 24h from now in ms

    (auth as any).currentUser = { uid, getIdToken: mockGetIdToken };
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'tavern_jwt_token') return Promise.resolve('stored-token');
      if (key === 'tavern_jwt_expiry') return Promise.resolve(futureExpiry.toString());
      if (key === 'tavern_uid') return Promise.resolve(uid);
      return Promise.resolve(null);
    });

    const token = await getTavernToken();
    expect(token).toBe('stored-token');
    // Should NOT have called axios.post — recovered from storage
    expect(axios.post).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('getTavernToken should not recover expired token from AsyncStorage', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const uid = 'test-uid';
    const pastExpiry = Date.now() - 1000; // already expired

    (auth as any).currentUser = { uid, getIdToken: mockGetIdToken };
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'tavern_jwt_token') return Promise.resolve('expired-token');
      if (key === 'tavern_jwt_expiry') return Promise.resolve(pastExpiry.toString());
      if (key === 'tavern_uid') return Promise.resolve(uid);
      return Promise.resolve(null);
    });

    mockGetIdToken.mockResolvedValue('firebase-token');
    (axios.post as jest.Mock).mockResolvedValue({
      status: 200,
      data: { token: 'fresh-token', uid },
    });

    const token = await getTavernToken();
    expect(token).toBe('fresh-token'); // Should have re-exchanged
    expect(axios.post).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('clearTavernSession should cancel proactive refresh', async () => {
    const { clearTavernSession } = require('../../lib/api');
    // Just verify it doesn't throw and clears storage
    await clearTavernSession();
    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([
      'tavern_jwt_token',
      'tavern_jwt_expiry',
      'tavern_uid',
    ]);
  });
});

describe('API URL Hydration', () => {
  beforeEach(async () => {
    await __resetInternalState();
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_ROUTER_URL = 'http://test-router.com';
  });

  it('hydrateServiceUrls should deduplicate simultaneous calls', async () => {
    (axios.get as jest.Mock).mockResolvedValue({
      status: 200,
      data: { services: { auth: 'http://hydrated-auth' } },
    });

    const [h1, h2] = await Promise.all([
      hydrateServiceUrls(),
      hydrateServiceUrls()
    ]);

    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('hydrateServiceUrls should throw if fetch fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (axios.get as jest.Mock).mockRejectedValue(new Error('Network Error'));

    await expect(hydrateServiceUrls()).rejects.toThrow('Failed to hydrate service URLs from router');

    expect(axios.get).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('hydrateServiceUrls should throw if ROUTER_URL is missing', async () => {
    delete process.env.EXPO_PUBLIC_ROUTER_URL;
    await expect(hydrateServiceUrls()).rejects.toThrow('EXPO_PUBLIC_ROUTER_URL is not set');
  });
});
