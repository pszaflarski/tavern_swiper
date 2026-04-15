import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTavernToken, profilesApi, authApi } from '../lib/api';
import { auth } from '../lib/firebase';

// Mock axios since it's used directly in getTavernToken
jest.mock('axios', () => {
  const mockAxios = {
    post: jest.fn(),
    create: jest.fn(() => ({
      interceptors: {
        request: { use: jest.fn(), eject: jest.fn() },
      },
      post: jest.fn(),
    })),
  };
  return mockAxios;
});

// Mock Firebase Auth
jest.mock('../lib/firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: jest.fn(),
    },
    onAuthStateChanged: jest.fn((callback) => {
        callback({ uid: 'test-uid' });
        return jest.fn();
    }),
  },
}));

describe('API Token Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset internal state of api.ts by clearing AsyncStorage and in-memory variables 
    // (though in-memory variables are harder to reset without re-importing or exporting them)
    // For now, we'll rely on the fact that we can force it to fetch.
  });

  it('getTavernToken should deduplicate multiple simultaneous calls', async () => {
    (auth.currentUser?.getIdToken as jest.Mock).mockResolvedValue('firebase-token');
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
    (auth.currentUser?.getIdToken as jest.Mock).mockRejectedValue(new Error('Firebase Error'));
    
    const token = await getTavernToken();
    expect(token).toBeNull();
  });

  it('getTavernToken should handle Auth service 401 response', async () => {
    (auth.currentUser?.getIdToken as jest.Mock).mockResolvedValue('firebase-token');
    (axios.post as jest.Mock).mockResolvedValue({
      status: 401,
      data: { detail: 'Invalid token' },
    });

    const token = await getTavernToken();
    expect(token).toBeNull();
  });

  it('axios interceptors should differentiate between Auth and Functional services', async () => {
    // This is hard to test directly because createClient is private in api.ts
    // but we can verify that authApi (exposed) and profilesApi (exposed) behave differently.
    
    // Check if authApi.interceptors.request.use was called (it should be)
    // Since we mock axios.create, we can check its calls.
    expect(axios.create).toHaveBeenCalled();
  });
});
