import axios from 'axios';
import { auth } from './firebase';

/**
 * Service base URLs — configurable via EXPO_PUBLIC_ env vars.
 */
const BASE_URLS = {
  auth: process.env.EXPO_PUBLIC_AUTH_URL ?? 'http://localhost:8001',
  profiles: process.env.EXPO_PUBLIC_PROFILES_URL ?? 'http://localhost:8002',
  discovery: process.env.EXPO_PUBLIC_DISCOVERY_URL ?? 'http://localhost:8003',
  swipes: process.env.EXPO_PUBLIC_SWIPES_URL ?? 'http://localhost:8004',
  messages: process.env.EXPO_PUBLIC_MESSAGES_URL ?? 'http://localhost:8005',
  users: process.env.EXPO_PUBLIC_USERS_URL ?? 'http://localhost:8006',
};

/**
 * Real Token Provider — fetches the current user's ID token from Firebase.
 * This is automatically injected into every request header.
 */
export async function getIdToken(): Promise<string | null> {
  const fetchWithTimeout = async (promise: Promise<string>, timeout: number = 5000) => {
    let timeoutHandle: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Token fetch timeout')), timeout);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
  };

  try {
    const user = auth.currentUser;
    if (!user) {
      console.log('[API DEBUG] getIdToken: No current user in firebase auth');
      return null;
    }
    const token = await fetchWithTimeout(user.getIdToken());
    if (!token) console.log('[API DEBUG] getIdToken: Token was empty/null');
    return token;
  } catch (error) {
    console.error('Error fetching ID token:', error);
    return null;
  }
}

function createClient(baseURL: string) {
  const client = axios.create({ baseURL, timeout: 10_000 });

  client.interceptors.request.use(async (config) => {
    const token = await getIdToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  return client;
}

/**
 * Wait for a valid Firebase token to be available.
 * Useful after registration/login to avoid race conditions.
 */
export async function waitForToken(timeout: number = 5000): Promise<string | null> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const token = await getIdToken();
        if (token) return token;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    return null;
}

export const authApi = createClient(BASE_URLS.auth);
export const profilesApi = createClient(BASE_URLS.profiles);
export const discoveryApi = createClient(BASE_URLS.discovery);
export const swipesApi = createClient(BASE_URLS.swipes);
export const messagesApi = createClient(BASE_URLS.messages);
export const usersApi = createClient(BASE_URLS.users);
