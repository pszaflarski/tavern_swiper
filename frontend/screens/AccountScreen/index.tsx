import React from 'react';
import { View, Text, Pressable } from 'react-native';
import ScreenHeader from '../../components/ScreenHeader';
import { useRouter } from 'expo-router';

import { useUser } from '../../hooks/useUser';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { styles } from './styles';

function AccountScreenInner() {
  const { logout, refetch } = useUser();
  const router = useRouter();

  useRefreshOnFocus(refetch);

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/auth');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <View style={styles.container} testID="account-screen">
      <ScreenHeader title="Account" />

      <View style={styles.content}>
        <Pressable 
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && { opacity: 0.7 }
          ]}
          onPress={handleLogout}
          testID="logout-button"
        >
          <Text style={styles.logoutButtonText}>Logout</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function AccountScreen() {
  return (
    <ScreenErrorBoundary fallbackMessage="The account scroll could not be unfurled.">
      <AccountScreenInner />
    </ScreenErrorBoundary>
  );
}
