import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { notificationsApi } from '../lib/api';
import { useRouter } from 'expo-router';
import { useUser } from './useUser';

// Suppress notification banners when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export function useNotifications() {
  const { isAuthenticated, uid } = useUser();
  const router = useRouter();
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !uid) {
      // If user logs out, unregister the token to keep DB clean
      if (tokenRef.current) {
        const tokenToUnregister = tokenRef.current;
        tokenRef.current = null;
        notificationsApi.delete(`/notifications/tokens/${encodeURIComponent(tokenToUnregister)}`)
          .then(() => console.log('[useNotifications] Token unregistered successfully on logout'))
          .catch(() => console.log('[useNotifications] Token unregister skipped (session ended)'));
      }
      return;
    }

    let isMounted = true;
    const notificationListener = { current: undefined as Notifications.Subscription | undefined };
    const responseListener = { current: undefined as Notifications.Subscription | undefined };

    async function registerAndSetup() {
      // 1. Setup Android channel if applicable (required for Android 8.0+)
      if (Platform.OS === 'android') {
        try {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
          });
        } catch (e) {
          console.error('[useNotifications] Failed to set Android notification channel:', e);
        }
      }

      // 2. Platform guard (Push notifications require physical devices/emulators with play services, not web)
      if (Platform.OS === 'web') {
        console.log('[useNotifications] Web platform detected, skipping push registration.');
        return;
      }

      // 3. Request permissions
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== 'granted') {
          console.warn('[useNotifications] Failed to get permission for push notifications!');
          return;
        }

        // 4. Retrieve Expo Project ID
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        if (!projectId) {
          console.warn('[useNotifications] No Expo projectId found in configuration.');
          return;
        }

        // 5. Get Expo Push Token
        const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        const token = tokenData.data;
        if (!token) {
          console.warn('[useNotifications] Failed to retrieve Expo push token.');
          return;
        }

        if (!isMounted) return;

        // Save token to ref so we can delete on logout
        tokenRef.current = token;

        // 6. Register with backend
        console.log('[useNotifications] Registering token with backend:', token);
        await notificationsApi.post('/notifications/tokens', {
          token: token,
          device_id: `${Platform.OS}-${uid}`,
          platform: Platform.OS,
        });
        console.log('[useNotifications] Token registered successfully.');

      } catch (err) {
        // Log gracefully (e.g. running in emulators without Play Services throws exception)
        console.warn('[useNotifications] Could not setup push notifications (this is expected in some simulators):', err);
      }
    }

    registerAndSetup();

    // 7. Foreground notification listener
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('[useNotifications] Notification received in foreground:', notification);
    });

    // 8. Interactive listener (when user taps/interacts with the notification)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('[useNotifications] Notification response received (tap):', response);
      const data = response.notification.request.content.data;
      
      if (data?.type === 'message' && data?.conversation_id) {
        console.log('[useNotifications] Routing to conversation:', data.conversation_id);
        router.push(`/messages/${data.conversation_id}`);
      } else if (data?.type === 'match') {
        console.log('[useNotifications] Routing to messages tab');
        router.push('/(tabs)/messages');
      }
    });

    return () => {
      isMounted = false;
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [isAuthenticated, uid]);
}
