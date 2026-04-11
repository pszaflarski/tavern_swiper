import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { auth } from '../../lib/firebase';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';
import ScreenHeader from '../../components/ScreenHeader';

import { useUser } from '../../hooks/useUser';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';

function AccountScreenInner() {
  const { logout, refetch } = useUser();

  useRefreshOnFocus(refetch);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <View style={styles.container} testID="account-screen">
      <ScreenHeader title="Account" />

      <View style={styles.content}>
        <TouchableOpacity 
          style={styles.logoutButton} 
          onPress={handleLogout}
          testID="logout-button"
        >
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing[6],
  },
  logoutButton: {
    backgroundColor: Colors.error,
    paddingVertical: Spacing[4],
    paddingHorizontal: Spacing[10],
    borderRadius: Radius.full,
    ...Shadow.waxSeal,
  },
  logoutButtonText: {
    fontFamily: Fonts.scribe,
    color: Colors.onError,
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
