import axios from 'axios';
import { auth } from './firebase';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Service base URLs — configurable via EXPO_PUBLIC_ env vars.
 */
let BASE_URLS: Record<string, string> = {
  auth: '',
  profiles: '',
  discovery: '',
  messages: '',
  users: '',
  quests: '',
};

let hydrationPromise: Promise<void> | null = null;
let hydrated = false;

export async function hydrateServiceUrls(): Promise<void> {
  if (hydrated) return;
  if (hydrationPromise) return hydrationPromise;
  
  const routerUrl = process.env.EXPO_PUBLIC_ROUTER_URL ?? '';
  if (!routerUrl) {
    throw new Error('EXPO_PUBLIC_ROUTER_URL is not set. Service discovery cannot proceed.');
  }

  hydrationPromise = (async () => {
    try {
      const res = await axios.get(`${routerUrl}/router/services`, {
        timeout: 5000,
      });
      const services = res.data?.services ?? {};
      for (const key of Object.keys(BASE_URLS)) {
        if (services[key]) {
          BASE_URLS[key] = services[key];
        }
      }
      hydrated = true;
    } catch (err) {
      console.error('[Router] Failed to fetch service URLs:', err);
      throw new Error(`Failed to hydrate service URLs from router: ${err}`);
    }
  })();

  return hydrationPromise;
}

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
  cachedTokenUid = null;
  pendingTokenExchange = null;
  cancelProactiveRefresh();
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
    await auth.signOut().catch((e: unknown) => console.error('[Auth] Firebase signOut failed:', e));
    
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

// ─── Tavern Token Management ─────────────────────────────────────────────────

let cachedTavernToken: string | null = null;
let tokenExpiryTime: number = 0; // ms — when the token expires (server time converted to local)
let cachedTokenUid: string | null = null;
let pendingTokenExchange: Promise<string | null> | null = null;

/**
 * Proactive refresh timer — refreshes the token before it expires.
 */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function cancelProactiveRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleProactiveRefresh(expiresAtMs: number) {
  cancelProactiveRefresh();
  
  const now = Date.now();
  const lifetime = expiresAtMs - now;
  
  // Refresh at 75% of the remaining lifetime, minimum 60 seconds before expiry
  const refreshAt = Math.max(lifetime * 0.75, lifetime - 60_000);
  
  if (refreshAt <= 0) {
    // Token is already close to expiry — refresh immediately
    console.log('[Auth] Token near expiry, refreshing immediately.');
    forceRefreshTavernToken();
    return;
  }
  
  console.log(`[Auth] Proactive refresh scheduled in ${Math.round(refreshAt / 1000)}s (token lifetime: ${Math.round(lifetime / 1000)}s)`);
  refreshTimer = setTimeout(() => {
    console.log('[Auth] Proactive refresh triggered.');
    forceRefreshTavernToken();
  }, refreshAt);
}

/**
 * Force-refresh the Tavern token by exchanging the Firebase ID token.
 * This clears any cached token and performs a fresh exchange.
 */
async function forceRefreshTavernToken(): Promise<string | null> {
  // Clear cached state to force a new exchange
  cachedTavernToken = null;
  tokenExpiryTime = 0;
  pendingTokenExchange = null;
  
  return getTavernToken();
}

/**
 * Persist token state to AsyncStorage for survival across app restarts.
 */
function persistTokenState(token: string, expiryMs: number, uid: string) {
  const storagePromise = AsyncStorage.multiSet([
    [TAVERN_TOKEN_KEY, token],
    [TAVERN_TOKEN_EXPIRY, expiryMs.toString()],
    [TAVERN_UID_KEY, uid],
  ]);
  
  if (storagePromise?.catch) {
    storagePromise.catch(e => console.error('[Storage] MultiSet failed:', e));
  }
}

/**
 * Core token acquisition — returns a valid Tavern JWT, using cache, storage, or fresh exchange.
 * 
 * Token lifecycle:
 * 1. Check in-memory cache (fast path)
 * 2. Check AsyncStorage (app restart recovery)
 * 3. Exchange Firebase ID token for a new Tavern JWT
 * 4. Schedule proactive refresh before the new token expires
 */
export async function getTavernToken(): Promise<string | null> {
  const now = Date.now();
  const currentUid = auth.currentUser?.uid ?? null;
  
  // Buffer: consider token stale 60s before actual expiry to avoid edge-case 401s
  const EXPIRY_BUFFER_MS = 60_000;
  
  // 1. Check in-memory cache (must match current user and not be expiring soon)
  if (cachedTavernToken && now < tokenExpiryTime - EXPIRY_BUFFER_MS && cachedTokenUid === currentUid) {
    return cachedTavernToken;
  }

  // 2. Check persistent storage if in-memory is empty (e.g. after reload)
  if (!cachedTavernToken) {
    try {
      const storedToken = await AsyncStorage.getItem(TAVERN_TOKEN_KEY);
      const storedExpiry = await AsyncStorage.getItem(TAVERN_TOKEN_EXPIRY);
      const storedUid = await AsyncStorage.getItem(TAVERN_UID_KEY);
      if (storedToken && storedExpiry) {
        const expiry = parseInt(storedExpiry, 10);
        if (now < expiry - EXPIRY_BUFFER_MS && storedUid === currentUid) {
          cachedTavernToken = storedToken;
          tokenExpiryTime = expiry;
          cachedTokenUid = currentUid;
          scheduleProactiveRefresh(expiry);
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
        console.log('[Auth] No Firebase token available for exchange.');
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
        
        // Use server-provided expiry if available, otherwise fallback to 23h
        const expiresAtSec = res.data.expires_at;
        const expiryMs = expiresAtSec
          ? expiresAtSec * 1000
          : Date.now() + (23 * 60 * 60 * 1000);
        
        cachedTavernToken = token;
        tokenExpiryTime = expiryMs;
        cachedTokenUid = auth.currentUser?.uid ?? null;
        
        persistTokenState(token, expiryMs, uid);
        scheduleProactiveRefresh(expiryMs);
        
        console.log(`[Auth] Tavern token acquired (expires in ${Math.round((expiryMs - Date.now()) / 60_000)}m)`);
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
function createClient(baseURLKey: keyof typeof BASE_URLS, useTavernToken: boolean = true) {
  // We don't set baseURL here because it's dynamic
  const client = axios.create({ timeout: 10_000 });

  client.interceptors.request.use(async (config) => {
    // Ensure URLs are hydrated
    await hydrateServiceUrls();
    // Dynamically set the base URL for this request
    config.baseURL = BASE_URLS[baseURLKey];

    // Auth service always expects Firebase ID Token for verification/login
    // Other services expect the Tavern JWT
    const token = useTavernToken ? await getTavernToken() : await getIdToken();
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // Response interceptor: smart retry on 401/403 with proper token refresh
  if (client?.interceptors?.response) {
    client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const status = error.response ? error.response.status : null;
        
        if ((status === 401 || status === 403) && !error.config._retried) {
          // Don't retry auth service calls (those handle their own errors)
          const isAuthService = error.config.url?.includes('/auth/');
          if (isAuthService) {
            return Promise.reject(error);
          }
          
          error.config._retried = true;
          
          // Step 1: Check if Firebase user still exists
          const firebaseUser = auth.currentUser;
          if (!firebaseUser) {
            // No Firebase user = real logout scenario
            console.warn('[Auth] 401 received and no Firebase user — logging out.');
            await performGlobalLogout();
            return Promise.reject(error);
          }
          
          // Step 2: Force-refresh the Tavern token
          console.log('[Auth] 401 received — force-refreshing Tavern token...');
          const newToken = await forceRefreshTavernToken();
          
          if (!newToken) {
            // Token refresh failed — Firebase user exists but can't get a new Tavern token
            // This could be a transient error. Don't logout, just fail the request.
            console.error('[Auth] Token refresh failed but Firebase user exists — NOT logging out.');
            return Promise.reject(error);
          }
          
          // Step 3: Retry the original request with the new token
          error.config.headers.Authorization = `Bearer ${newToken}`;
          try {
            return await client.request(error.config);
          } catch (retryError) {
            // Retry also failed with fresh token — still don't auto-logout
            // The user's Firebase session is valid; this is a service-level issue
            console.error('[Auth] Retry with fresh token still failed.');
            return Promise.reject(retryError);
          }
        }
        
        return Promise.reject(error);
      }
    );
  }

  return client;
}

// Auth API uses Firebase ID Tokens (as it is the issuer of Tavern Tokens)
export const authApi = createClient('auth', false);

// Functional APIs use the custom Tavern JWT
export const profilesApi = createClient('profiles', true);
export const discoveryApi = createClient('discovery', true);
export const swipesApi = createClient('discovery', true);
export const messagesApi = createClient('messages', true);
export const usersApi = createClient('users', true);
export const questsApi = createClient('quests', true);

/**
 * Internal state check for development and reset for tests.
 */
function validateEnvironment() {
  if (process.env.NODE_ENV === 'test') return;

  // If ROUTER_URL is set, URLs will be hydrated at runtime — no need to warn
  const routerUrl = process.env.EXPO_PUBLIC_ROUTER_URL ?? '';
  if (routerUrl) return;

  const entries = Object.entries(BASE_URLS) as [string, string][];
  const onLocalhost = entries.filter(([, url]) => url.includes('localhost'));

  if (onLocalhost.length > 0) {
    console.warn(
      '⚠️ Some service URLs are using localhost fallbacks (no EXPO_PUBLIC_ROUTER_URL set):',
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
  cachedTokenUid = null;
  pendingTokenExchange = null;
  authInitialized = false;
  authInitializedPromise = null;
  hydrated = false;
  hydrationPromise = null;
  cancelProactiveRefresh();
  BASE_URLS = {
    auth: 'http://localhost:8001',
    profiles: 'http://localhost:8002',
    discovery: 'http://localhost:8003',
    messages: 'http://localhost:8005',
    users: 'http://localhost:8006',
    quests: 'http://localhost:8013',
  };
  try {
    await AsyncStorage.clear();
  } catch (e) {
    // Ignore clear errors in tests
  }
}

validateEnvironment();
