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
 */
export async function getIdToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch (error) {
    console.error('Error fetching ID token:', error);
    return null;
  }
}

/**
 * Tavern Token management — exchanges Firebase ID tokens for our custom Tavern JWT.
 */
let cachedTavernToken: string | null = null;
let tokenExpiryTime: number = 0; // ms

export async function getTavernToken(): Promise<string | null> {
  // 1. Return cached token if valid (with 30s buffer)
  const now = Date.now();
  if (cachedTavernToken && now < tokenExpiryTime - 30_000) {
    return cachedTavernToken;
  }

  // 2. Exchange Firebase token for a Tavern token
  try {
    const firebaseToken = await getIdToken();
    if (!firebaseToken) return null;

    // Call Auth service directly for the exchange
    // We use a raw axios call here to avoid circular interceptors
    const res = await axios.post(`${BASE_URLS.auth}/auth/verify`, {
      id_token: firebaseToken
    }, { timeout: 10_000 });

    if (res.status === 200 && res.data.token) {
      cachedTavernToken = res.data.token;
      // We assume a 30m expiry from the backend; we'll set locally to 28m
      tokenExpiryTime = now + (28 * 60 * 1000); 
      return cachedTavernToken;
    }
    return null;
  } catch (error) {
    console.error('Error exchanging Tavern token:', error);
    return null;
  }
}

/**
 * Client factory — creates an Axios instance with appropriate interceptors.
 * @param baseURL The service base URL
 * @param useTavernToken Whether to use the Tavern JWT (true) or fallback to Firebase (false)
 */
function createClient(baseURL: string, useTavernToken: boolean = true) {
  const client = axios.create({ baseURL, timeout: 10_000 });

  client.interceptors.request.use(async (config) => {
    // Auth service always expects Firebase ID Token for verification/login
    // Other services expect the Tavern JWT
    const token = useTavernToken ? await getTavernToken() : await getIdToken();
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  return client;
}

// Auth API uses Firebase ID Tokens (as it is the issuer of Tavern Tokens)
export const authApi = createClient(BASE_URLS.auth, false);

// Functional APIs use the custom Tavern JWT
export const profilesApi = createClient(BASE_URLS.profiles, true);
export const discoveryApi = createClient(BASE_URLS.discovery, true);
export const swipesApi = createClient(BASE_URLS.swipes, true);
export const messagesApi = createClient(BASE_URLS.messages, true);
export const usersApi = createClient(BASE_URLS.users, true);
