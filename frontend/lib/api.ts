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
async function getIdToken(): Promise<string | null> {
  const fetchWithTimeout = async (promise: Promise<string>, timeout: number = 5000) => {
    let timeoutHandle: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Token fetch timeout')), timeout);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
  };

  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await fetchWithTimeout(user.getIdToken());
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

export const authApi = createClient(BASE_URLS.auth);
export const profilesApi = createClient(BASE_URLS.profiles);
export const discoveryApi = createClient(BASE_URLS.discovery);
export const swipesApi = createClient(BASE_URLS.swipes);
export const messagesApi = createClient(BASE_URLS.messages);
export const usersApi = createClient(BASE_URLS.users);
