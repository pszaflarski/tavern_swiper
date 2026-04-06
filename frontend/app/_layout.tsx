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

export {
  ErrorBoundary,
} from 'expo-router';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

import { ProfileProvider } from '../context/ProfileContext';

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

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ProfileProvider>
          <RootLayoutNav />
        </ProfileProvider>
      </QueryClientProvider>
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

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to the login page if the user is not authenticated
      router.replace('/auth');
    } else if (isAuthenticated && inAuthGroup) {
      // Redirect away from the login page if the user is authenticated
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
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="auth" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
    </Stack>
  );
}
