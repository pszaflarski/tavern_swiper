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

import { ProfileProvider } from '../context/ProfileContext';
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
    // Let the ErrorBoundary handled it if it's thrown, but we'll also log here.
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
        <QueryClientProvider client={queryClient}>
          <ProfileProvider>
            <MatchProvider>
              <RootLayoutNav />
            </MatchProvider>
          </ProfileProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useUser();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'auth';

    console.log('[RootLayoutNav] Auth state changed:', { isAuthenticated, isLoading, segment: segments[0] });

    if (!isAuthenticated && !inAuthGroup) {
      console.log('[RootLayoutNav] Redirecting to /auth');
      router.replace('/auth');
    } else if (isAuthenticated && inAuthGroup) {
      console.log('[RootLayoutNav] Redirecting to /(tabs)');
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments]);

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
      </Stack>
      <MatchSplash />
      <Toast />
    </>
  );
}
