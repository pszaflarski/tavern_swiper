import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { auth } from '../../lib/firebase';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';

export default function AccountScreen() {
  const handleLogout = async () => {
    try {
      await auth.signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <View style={styles.container} testID="account-screen">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Account</Text>
        <Text style={styles.headerSub}>Manage Your Identity</Text>
      </View>

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    paddingTop: Spacing[16],
    paddingBottom: Spacing[4],
    paddingHorizontal: Spacing[6],
    backgroundColor: Colors.surfaceContainerLowest,
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 28,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 1,
  },
  headerSub: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: Spacing[2],
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
