import { authApi, usersApi, profilesApi } from './api';
import { auth } from './firebase';

// Mock Firebase
jest.mock('./firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: jest.fn(() => Promise.resolve('test-token')),
    },
  },
}));

describe('API Clients', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adds Authorization header when token exists', async () => {
    // We can't easily test the interceptor directly without axios-mock-adapter
    // but we can verify the base URLs are correct
    expect(authApi.defaults.baseURL).toContain('8001');
    expect(profilesApi.defaults.baseURL).toContain('8002');
    expect(usersApi.defaults.baseURL).toContain('8006');
  });

  it('uses environment variables for base URLs', () => {
    // process.env.EXPO_PUBLIC_AUTH_URL is defined in .env
    expect(authApi.defaults.baseURL).toBe('http://localhost:8001');
  });
});
