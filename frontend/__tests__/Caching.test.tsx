import { QueryClient } from '@tanstack/react-query';
import { profilesApi } from '../lib/api';

// Mock the API layer
jest.mock('../lib/api', () => ({
  profilesApi: {
    get: jest.fn(),
  },
}));

describe('Caching & staleTime Logic (Pure QueryClient)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 300000, // 5 minutes (default for our test)
          gcTime: Infinity,
        },
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    queryClient.clear();
    jest.clearAllMocks();
  });

  it('should respect the staleTime and avoid redundant API calls', async () => {
    const mockData = [{ profile_id: 'p1', display_name: 'Thorin' }];
    const userId = 'user-123';
    const queryKey = ['profiles', 'user', userId];
    
    // Mock resolving
    (profilesApi.get as jest.Mock).mockResolvedValue({ data: mockData });

    // 1. Initial fetch
    await queryClient.fetchQuery({ 
      queryKey, 
      queryFn: () => profilesApi.get(`/profiles/user/${userId}`) 
    });
    
    expect(profilesApi.get).toHaveBeenCalledTimes(1);

    // 2. Immediate second fetch - should be cached and NOT call API
    await queryClient.fetchQuery({ 
      queryKey, 
      queryFn: () => profilesApi.get(`/profiles/user/${userId}`) 
    });
    expect(profilesApi.get).toHaveBeenCalledTimes(1);

    // 3. Advance time past staleTime (e.g. 6 minutes)
    jest.advanceTimersByTime(360000);
    
    // 4. Fetch again - should be stale and trigger a new API call
    await queryClient.fetchQuery({ 
      queryKey, 
      queryFn: () => profilesApi.get(`/profiles/user/${userId}`) 
    });
    
    expect(profilesApi.get).toHaveBeenCalledTimes(2);
  });
});
