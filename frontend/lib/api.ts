import axios from 'axios';
import { auth } from './firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Service base URLs — configurable via EXPO_PUBLIC_ env vars.
 */
const BASE_URLS = {
  auth: process.env.EXPO_PUBLIC_AUTH_URL ?? 'http://localhost:8001',
  profiles: process.env.EXPO_PUBLIC_PROFILES_URL ?? 'http://localhost:8002',
  discovery: process.env.EXPO_PUBLIC_DISCOVERY_URL ?? 'http://localhost:8003',
  swipes: process.env.EXPO_PUBLIC_DISCOVERY_URL ?? 'http://localhost:8003',
  messages: process.env.EXPO_PUBLIC_MESSAGES_URL ?? 'http://localhost:8005',
  users: process.env.EXPO_PUBLIC_USERS_URL ?? 'http://localhost:8006',
};

const TAVERN_TOKEN_KEY = 'tavern_jwt_token';
const TAVERN_TOKEN_EXPIRY = 'tavern_jwt_expiry';

/**
 * Helper to wait for Firebase Auth to initialize.
 */
let authInitializedPromise: Promise<void> | null = null;
export function waitForAuth(): Promise<void> {
  if (authInitializedPromise) return authInitializedPromise;
  
  authInitializedPromise = new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged(() => {
      unsubscribe();
      resolve();
    });
  });
  return authInitializedPromise;
}

/**
 * Real Token Provider — fetches the current user's ID token from Firebase.
 */
export async function getIdToken(): Promise<string | null> {
  try {
    await waitForAuth();
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
let pendingTokenExchange: Promise<string | null> | null = null;

export async function getTavernToken(): Promise<string | null> {
  const now = Date.now();
  
  // 1. Check in-memory cache first
  if (cachedTavernToken && now < tokenExpiryTime - 30_000) {
    return cachedTavernToken;
  }

  // 2. Check persistent storage if in-memory is empty (e.g. after reload)
  if (!cachedTavernToken) {
    try {
      const storedToken = await AsyncStorage.getItem(TAVERN_TOKEN_KEY);
      const storedExpiry = await AsyncStorage.getItem(TAVERN_TOKEN_EXPIRY);
      if (storedToken && storedExpiry) {
        const expiry = parseInt(storedExpiry, 10);
        if (now < expiry - 30_000) {
          cachedTavernToken = storedToken;
          tokenExpiryTime = expiry;
          return cachedTavernToken;
        }
      }
    } catch (e) {
      console.warn('Failed to load Tavern token from storage:', e);
    }
  }

  // 3. If we have a pending exchange, wait for it (deduplication)
  if (pendingTokenExchange) {
    return pendingTokenExchange;
  }

  // 4. Exchange Firebase token for a Tavern token
  pendingTokenExchange = (async () => {
    try {
      const firebaseToken = await getIdToken();
      if (!firebaseToken) return null;

      const res = await axios.post(`${BASE_URLS.auth}/auth/verify`, {
        id_token: firebaseToken
      }, { timeout: 10_000 });

      if (res.status === 200 && res.data.token) {
        const token = res.data.token;
        const expiry = Date.now() + (28 * 60 * 1000); // 28m locally for 30m server expiry
        
        // Update both caches
        cachedTavernToken = token;
        tokenExpiryTime = expiry;
        
        await AsyncStorage.setItem(TAVERN_TOKEN_KEY, token);
        await AsyncStorage.setItem(TAVERN_TOKEN_EXPIRY, expiry.toString());
        
        return token;
      }
      return null;
    } catch (error) {
      console.error('Error exchanging Tavern token:', error);
      return null;
    } finally {
      pendingTokenExchange = null;
    }
  })();

  return pendingTokenExchange;
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
