import axios from 'axios';
import { auth } from './firebase';
import { router } from 'expo-router';
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
const TAVERN_UID_KEY = 'tavern_uid';

/**
 * Helper to wait for Firebase Auth to initialize.
 */
let authInitialized = false;
let authInitializedPromise: Promise<void> | null = null;

export function waitForAuth(): Promise<void> {
  if (authInitialized) return Promise.resolve();
  if (authInitializedPromise) return authInitializedPromise;
  
  authInitializedPromise = new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged(() => {
      authInitialized = true;
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
 * Session Management
 */
export async function clearTavernSession(): Promise<void> {
  cachedTavernToken = null;
  tokenExpiryTime = 0;
  try {
    await AsyncStorage.multiRemove([TAVERN_TOKEN_KEY, TAVERN_TOKEN_EXPIRY, TAVERN_UID_KEY]);
  } catch (e) {
    console.error('Failed to clear Tavern session:', e);
  }
}

/**
 * Perform a full global logout — clears both Firebase AND Tavern sessions,
 * then redirects to the auth screen.
 */
export async function performGlobalLogout() {
  console.warn('[Auth] Triggering global logout due to session failure.');
  try {
    cachedTavernToken = null;
    tokenExpiryTime = 0;
    
    // 1. Sign out from Firebase
    await auth.signOut().catch(e => console.error('[Auth] Firebase signOut failed:', e));
    
    // 2. Clear local storage
    await clearTavernSession();
    
    // 3. Redirect to auth screen
    router.replace('/auth');
  } catch (error) {
    console.error('[Auth] Global logout failed:', error);
    // Fallback redirect even if clearing fails
    router.replace('/auth');
  }
}

export async function getPersistedUid(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TAVERN_UID_KEY);
  } catch (e) {
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
      console.warn('[Session] Failed to load Tavern token from storage:', e);
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
      if (!firebaseToken) {
        console.warn('[Auth] No Firebase token available for exchange.');
        return null;
      }

      // Call Auth service directly for the exchange
      const res = await axios.post(`${BASE_URLS.auth}/auth/verify`, {
        id_token: firebaseToken
      }, { 
        timeout: 15_000,
        headers: { 'Content-Type': 'application/json' },
        validateStatus: (status) => status < 500
      });

      if (res.status === 200 && res.data?.token) {
        const token = res.data.token;
        const uid = res.data.uid;
        const expiry = Date.now() + (28 * 60 * 1000); // 28m locally for 30m server expiry
        
        cachedTavernToken = token;
        tokenExpiryTime = expiry;
        
        await AsyncStorage.multiSet([
          [TAVERN_TOKEN_KEY, token],
          [TAVERN_TOKEN_EXPIRY, expiry.toString()],
          [TAVERN_UID_KEY, uid]
        ]).catch(e => console.error('[Storage] MultiSet failed:', e));
        
        return token;
      }
      
      console.error(`[Auth] Tavern token exchange failed with status ${res.status}:`, res.data);
      return null;
    } catch (error: any) {
      console.error('[Auth] Error exchanging Tavern token:', error?.message || error);
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

  // Response interceptor for automatic logout on 401/403
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const status = error.response ? error.response.status : null;
      
      if (status === 401 || status === 403) {
        // Only trigger auto-logout if we aren't already on the auth screen 
        // and if it's not a verification attempt (which we handle locally)
        const isAuthService = error.config.url?.includes('/auth/');
        if (!isAuthService) {
          await performGlobalLogout();
        }
      }
      
      return Promise.reject(error);
    }
  );

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

/**
 * Internal state check for development and reset for tests.
 */
function validateEnvironment() {
  if (process.env.NODE_ENV === 'test') return;

  const entries = Object.entries(BASE_URLS) as [string, string][];
  const onLocalhost = entries.filter(([, url]) => url.includes('localhost'));

  if (onLocalhost.length > 0) {
    console.warn(
      '⚠️ Some service URLs are using localhost fallbacks (env vars were not set at build time):',
      onLocalhost.map(([name]) => name).join(', ')
    );
  }
}

/**
 * ONLY FOR TESTS: Resets all internal module state to ensure test isolation.
 */
export async function __resetInternalState() {
  if (process.env.NODE_ENV !== 'test') return;
  
  cachedTavernToken = null;
  tokenExpiryTime = 0;
  pendingTokenExchange = null;
  authInitialized = false;
  authInitializedPromise = null;
  try {
    await AsyncStorage.clear();
  } catch (e) {
    // Ignore clear errors in tests
  }
}

validateEnvironment();
