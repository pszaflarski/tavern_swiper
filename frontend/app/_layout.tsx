import { useFonts, Manrope_400Regular, Manrope_700Bold } from '@expo-google-fonts/manrope';
import { NotoSerif_400Regular, NotoSerif_700Bold } from '@expo-google-fonts/noto-serif';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUser } from '../hooks/useUser';
import { Colors } from '../theme';
import { View, ActivityIndicator } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { hydrateServiceUrls } from '../lib/api';

export {
  ErrorBoundary,
} from 'expo-router';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    },
    mutations: {
      onError: (error: any) => {
        console.error('Mutation failed:', error);
        Toast.show({
          type: 'error',
          text1: 'Magic Failed',
          text2: error.message || 'The spell could not be completed at this time.',
        });
      },
    },
  },
});

import { AuthProvider } from '../context/AuthContext';
import { ProfileProvider, useProfileContext } from '../context/ProfileContext';
import { MatchProvider } from '../context/MatchContext';
import MatchSplash from '../components/MatchSplash';

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Manrope: Manrope_400Regular,
    ManropeBold: Manrope_700Bold,
    NotoSerif: NotoSerif_400Regular,
    NotoSerifBold: NotoSerif_700Bold,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    // Start hydrating service URLs in the background as soon as the app starts
    hydrateServiceUrls().catch(e => console.error('[RootLayout] Hydration error:', e));
  }, []);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  console.log('[RootLayout] State:', { loaded, hasError: !!error });

  if (!loaded && !error) {
    return null;
  }

  if (error) {
    console.error('[RootLayout] Font loading error:', error);
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ProfileProvider>
              <MatchProvider>
                <RootLayoutNav />
              </MatchProvider>
            </ProfileProvider>
          </AuthProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useUser();
  const { profiles, isLoadingProfiles } = useProfileContext();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Wait for auth and the profile list (but NOT the active-profile query,
    // which retries 404s and would delay routing by ~4.5s for new users).
    if (isLoading || isLoadingProfiles) return;

    const inAuthGroup = segments[0] === 'auth';

    console.log('[RootLayoutNav] Auth state changed:', { isAuthenticated, isLoading, segment: segments[0], profileCount: profiles?.length });

    if (!isAuthenticated && !inAuthGroup) {
      console.log('[RootLayoutNav] Redirecting to /auth');
      router.replace('/auth');
    } else if (isAuthenticated && inAuthGroup) {
      // If user has no profiles, land them on the Profiles tab
      // so they can forge their first identity immediately.
      const hasProfiles = profiles && profiles.length > 0;
      if (hasProfiles) {
        console.log('[RootLayoutNav] Redirecting to /(tabs)');
        router.replace('/(tabs)');
      } else {
        console.log('[RootLayoutNav] No profiles — redirecting to /(tabs)/profiles');
        router.replace('/(tabs)/profiles');
      }
    }
  }, [isAuthenticated, isLoading, isLoadingProfiles, profiles, segments]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="profiles" options={{ headerShown: false }} />
        <Stack.Screen name="inventory" options={{ headerShown: false }} />
      </Stack>
      <MatchSplash />
      <Toast />
    </>
  );
}
