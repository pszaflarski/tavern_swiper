import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  Alert,
  ActivityIndicator,
  Switch,
  Platform,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';
import { usersApi, authApi, waitForToken } from '../../lib/api';
import { useUser, UserMetadata } from '../../hooks/useUser';
import { auth } from '../../lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from '@firebase/auth';

export default function AdminDashboard() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading } = useUser();
  const [rootExists, setRootExists] = useState<boolean | null>(null);
  const [users, setUsers] = useState<UserMetadata[]>([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Create User Form State
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin' | 'root_admin'>('user');

  // Init/Login Form State
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  // --- Navigation Guards ---
  // We handle unauthenticated redirection declaratively in the render blocks below
  // to ensure all hooks are called consistently first.

  useEffect(() => {
    checkRootAdmin();
  }, []);

  const checkRootAdmin = async () => {
    console.log('[ADMIN DEBUG] checkRootAdmin: Starting check...');
    try {
      const res = await usersApi.get('/users/root-admin-exists');
      console.log(`[ADMIN DEBUG] checkRootAdmin: Backend response exists=${res.data.exists}`);
      setRootExists(res.data.exists);
    } catch (err: any) {
      console.error('[ADMIN DEBUG] checkRootAdmin: Error', err);
      setError(`Failure identifying the Nexus architecture: ${err.message}`);
    }
  };

  useEffect(() => {
    if (isAuthenticated && (user?.user_type === 'admin' || user?.user_type === 'root_admin')) {
      fetchUsers();
    }
  }, [isAuthenticated, user, showDeleted]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await usersApi.get(`/users/?include_deleted=${showDeleted}`);
      setUsers(res.data);
    } catch (err) {
      console.error('Failed to fetch users', err);
    } finally {
      setLoading(false);
    }
  };

  const handleClaimRoot = async () => {
    if (!authEmail || !authPassword) return;
    setLoading(true);
    try {
      // 1. Register or Login in Firebase Auth
      let firebaseUser;
      try {
        const res = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        firebaseUser = res.user;
      } catch (err: any) {
        if (err.code === 'auth/email-already-in-use') {
          const res = await signInWithEmailAndPassword(auth, authEmail, authPassword);
          firebaseUser = res.user;
        } else {
          throw err;
        }
      }

      // 2. Create Root Admin in Users Service
      // Ensure the token provider has the user updated
      console.log('[ADMIN DEBUG] handleClaimRoot: User registered, waiting for token...');
      const token = await waitForToken();
      if (!token) {
        throw new Error('Authentication token propagation timed out. Please try claiming again.');
      }
      
      console.log('[ADMIN DEBUG] handleClaimRoot: Token acquired, creating record...');
      await usersApi.post('/users/', {
        email: authEmail,
        user_type: 'root_admin',
      });

      // Refetch state globally
      await queryClient.invalidateQueries({ queryKey: ['admin', 'root-exists'] });
      await queryClient.invalidateQueries({ queryKey: ['user', 'me'] });
      
      Alert.alert('Success', 'Root Throne Claimed! Please log in to the dashboard.');
      console.log('[ADMIN DEBUG] handleClaimRoot: Success, manually setting rootExists to true');
      setRootExists(true);
    } catch (err: any) {
      console.error('[ADMIN DEBUG] handleClaimRoot: Unexpected exception', err);
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNuke = async () => {
    if (Platform.OS === 'web') {
      const result = window.prompt(
        'CRITICAL WARNING: This will PERMANENTLY EXTERMINATE ALL records. Type "TERMINATE" to confirm:'
      );
      if (result === 'TERMINATE') {
        try {
          await usersApi.delete('/users/');
          Alert.alert('Success', 'The Universe has been Cleaned.');
          await auth.signOut();
          router.replace('/admin');
        } catch (err: any) {
          Alert.alert('Error', err.message);
        }
      }
    } else {
      Alert.prompt(
        'CRITICAL WARNING',
        'This will PERMANENTLY EXTERMINATE ALL records. Type "TERMINATE" to confirm:',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'TERMINATE',
            onPress: async (text) => {
              if (text === 'TERMINATE') {
                try {
                  await usersApi.delete('/users/');
                  Alert.alert('Success', 'The Universe has been Cleaned.');
                  await auth.signOut();
                  router.replace('/admin');
                } catch (err: any) {
                  Alert.alert('Error', err.message);
                }
              }
            },
          },
        ],
        'plain-text'
      );
    }
  };

  const handleProvision = async () => {
    if (!newEmail || !newPassword) return;
    setLoading(true);
    try {
      // 1. Register in Auth Service (we use our internal authApi for admin-led creation if possible, 
      // but the legacy admin.html used the endpoint /auth/register which we can call via authApi)
      const authRes = await authApi.post('/auth/register', { email: newEmail, password: newPassword });
      
      // 2. Create in Users Service
      await usersApi.post('/users/', {
        email: newEmail,
        user_type: newRole,
        uid: authRes.data.uid
      });

      Alert.alert('Success', `Intelligence Provisioned: ${newEmail}`);
      setNewEmail('');
      setNewPassword('');
      await fetchUsers();
    } catch (err: any) {
      Alert.alert('Provisioning Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (uid: string, hard: boolean) => {
    const message = hard 
      ? 'CRITICAL WARNING: This will PERMANENTLY EXTERMINATE this entity from both the Nexus and the identity store. Do you wish to proceed?'
      : 'Do you wish to soft-delete this entity from the Nexus?';

    if (Platform.OS === 'web') {
        if (window.confirm(message)) {
            console.log(`[ADMIN DEBUG] handleDeleteUser: Requesting ${hard ? 'HARD' : 'SOFT'} delete for ${uid}`);
            try {
                await usersApi.delete(`/users/${uid}${hard ? '?hard=true' : ''}`);
                console.log('[ADMIN DEBUG] handleDeleteUser: Delete success, refreshing list...');
                await fetchUsers();
            } catch (err: any) {
                alert(err.message);
            }
        }
        return;
    }

    Alert.alert(
      'Confirm Action',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Proceed',
          onPress: async () => {
            try {
              console.log(`[ADMIN DEBUG] handleDeleteUser: Requesting ${hard ? 'HARD' : 'SOFT'} delete for ${uid}`);
              await usersApi.delete(`/users/${uid}${hard ? '?hard=true' : ''}`);
              console.log('[ADMIN DEBUG] handleDeleteUser: Delete success, refreshing list...');
              await fetchUsers();
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  const handleRestoreUser = async (uid: string) => {
    const message = 'Are you sure you want to restore this intelligence?';

    if (Platform.OS === 'web') {
        if (window.confirm(message)) {
            console.log(`[ADMIN DEBUG] handleRestoreUser: Requesting restore for ${uid}`);
            try {
                await usersApi.patch(`/users/${uid}/restore`);
                console.log('[ADMIN DEBUG] handleRestoreUser: Restore success, refreshing list...');
                await fetchUsers();
            } catch (err: any) {
                alert(err.message);
            }
        }
        return;
    }

    Alert.alert(
      'Confirm Action',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Proceed',
          onPress: async () => {
            try {
              console.log(`[ADMIN DEBUG] handleRestoreUser: Requesting restore for ${uid}`);
              await usersApi.patch(`/users/${uid}/restore`);
              console.log('[ADMIN DEBUG] handleRestoreUser: Restore success, refreshing list...');
              Alert.alert('Success', 'Entity has been restored to the active list.');
              await fetchUsers();
            } catch (err: any) {
              Alert.alert('Error', err.message);
            }
          },
        },
      ]
    );
  };

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={64} color={Colors.error} />
        <Text style={[styles.title, { color: Colors.error }]}>Nexus Offline</Text>
        <Text style={styles.subtitle}>{error}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => { setError(null); checkRootAdmin(); }}>
          <Text style={styles.buttonText}>Retry Connection</Text>
        </TouchableOpacity>
      </View>
    );
  }

  console.log(`[ADMIN DEBUG] Render state: authLoading=${authLoading}, isAuthenticated=${isAuthenticated}, rootExists=${rootExists}, url=${router.toString()}`);

  if (authLoading || rootExists === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  // Declarative Guard: Redirect unauthenticated users immediately
  if (!isAuthenticated) {
    return <Redirect href="/auth" />;
  }

  // --- Initialisation Screen ---
  if (!rootExists) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Initialize Nexus', headerShown: true }} />
        <View style={styles.card}>
          <Text style={styles.title}>Initialize Nexus</Text>
          <Text style={styles.subtitle}>Welcome, Architect. Claim the root throne.</Text>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={Colors.outlineVariant}
            value={authEmail}
            onChangeText={setAuthEmail}
            testID="admin-init-email"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={Colors.outlineVariant}
            value={authPassword}
            onChangeText={setAuthPassword}
            secureTextEntry
            testID="admin-init-password"
          />
          <TouchableOpacity 
            style={styles.primaryButton} 
            onPress={handleClaimRoot} 
            disabled={loading} 
            testID="admin-init-submit"
            accessibilityRole="button"
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Claim the Root</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- Access Denied ---
  if (isAuthenticated && user?.user_type === 'user') {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Access Denied', headerShown: true }} />
        <Ionicons name="lock-closed" size={64} color={Colors.error} />
        <Text style={[styles.title, { color: Colors.error }]}>Access Denied</Text>
        <Text style={styles.subtitle}>Restriction: Insufficient Clearances.</Text>
        <TouchableOpacity style={styles.ghostButton} onPress={() => auth.signOut()}>
          <Text style={styles.ghostButtonText}>Return to Surface</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Dashboard ---
  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ 
        title: 'Nexus Dashboard', 
        headerShown: true,
        headerRight: () => (
          <TouchableOpacity 
            onPress={async () => {
              await auth.signOut();
              router.replace('/auth');
            }} 
            style={{ marginRight: 16 }}
            testID="admin-logout-button"
          >
             <Ionicons name="log-out-outline" size={24} color={Colors.primary} />
          </TouchableOpacity>
        )
      }} />

      <View style={{ padding: Spacing[4] }}>
        {/* Provisioning Section */}
        <View style={styles.card} testID="admin-dashboard-header">
          <Text style={styles.sectionTitle}>Provision Intelligence</Text>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={Colors.outlineVariant}
            value={newEmail}
            onChangeText={setNewEmail}
            testID="admin-provision-email"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={Colors.outlineVariant}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            testID="admin-provision-password"
          />
          <View style={styles.roleSelector}>
            {(['user', 'admin', 'root_admin'] as const).map((role) => (
              <TouchableOpacity
                key={role}
                style={[styles.roleButton, newRole === role && styles.roleButtonActive]}
                onPress={() => setNewRole(role)}
              >
                <Text style={[styles.roleButtonText, newRole === role && styles.roleButtonTextActive]}>
                  {role.replace('_', ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity 
            style={styles.primaryButton} 
            onPress={handleProvision} 
            disabled={loading} 
            testID="admin-provision-submit"
            accessibilityRole="button"
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Provision</Text>}
          </TouchableOpacity>
        </View>

        {/* Users List Section */}
        <View style={[styles.card, { marginTop: Spacing[6] }]}>
          <View style={styles.listHeader}>
            <Text style={styles.sectionTitle}>Identified Entities</Text>
            <View style={styles.switchContainer}>
              <Text style={styles.switchLabel}>Deleted</Text>
              <Switch
                value={showDeleted}
                onValueChange={setShowDeleted}
                trackColor={{ false: Colors.surfaceContainer, true: Colors.primary }}
                testID="admin-show-deleted-switch"
              />
            </View>
          </View>

          {loading && !users.length ? (
            <ActivityIndicator color={Colors.primary} style={{ margin: 20 }} />
          ) : (
            users.map((u) => (
              <View key={u.uid} style={[styles.userRow, u.is_deleted && styles.userRowDeleted]} testID={`admin-user-row-${u.email}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userEmail}>{u.email}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <Text style={[styles.badge, styles[`badge_${u.user_type}` as keyof typeof styles]]}>
                      {u.user_type}
                    </Text>
                    {u.is_deleted && (
                      <Text 
                        style={[styles.badge, styles.badge_deleted]} 
                        testID="admin-user-is-deleted"
                      >
                        Deleted
                      </Text>
                    )}
                  </View>
                </View>
                
                <View style={styles.actions}>
                  {u.uid === user?.uid ? (
                    <Text style={styles.currentLabel}>Current</Text>
                  ) : u.is_deleted ? (
                    <>
                      <TouchableOpacity 
                        onPress={() => handleRestoreUser(u.uid)} 
                        style={styles.actionIcon}
                        testID="admin-restore-user-button"
                        accessibilityRole="button"
                      >
                        <Ionicons name="refresh" size={20} color={Colors.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        onPress={() => handleDeleteUser(u.uid, true)} 
                        style={styles.actionIcon}
                        testID="admin-hard-delete-user-button"
                        accessibilityRole="button"
                      >
                        <Ionicons name="trash-outline" size={20} color={Colors.error} />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity 
                        testID="admin-delete-user-button" 
                        accessibilityRole="button"
                        onPress={() => handleDeleteUser(u.uid, false)} 
                        style={styles.actionIcon}
                      >
                        <Ionicons name="remove-circle-outline" size={20} color={Colors.outline} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        testID="admin-hard-delete-user-button"
                        accessibilityRole="button"
                        onPress={() => handleDeleteUser(u.uid, true)} 
                        style={styles.actionIcon}
                      >
                        <Ionicons name="skull-outline" size={20} color={Colors.error} />
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            ))
          )}
        </View>

        {/* Danger Zone */}
        {user?.user_type === 'root_admin' && (
          <View style={[styles.card, styles.dangerZone]}>
            <Text style={[styles.sectionTitle, { color: Colors.error }]}>Danger Zone</Text>
            <Text style={styles.dangerText}>Permanently exterminate all records from both Firestore and Auth.</Text>
            <TouchableOpacity 
              style={styles.nukeButton} 
              onPress={handleNuke} 
              testID="admin-nuke-button"
              accessibilityRole="button"
            >
              <Text style={styles.nukeButtonText}>Nuke All Entities</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing[6],
    backgroundColor: Colors.background,
  },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    padding: Spacing[6],
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    ...Shadow.waxSeal,
  },
  title: {
    fontFamily: Fonts.heroic,
    fontSize: 28,
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: Spacing[2],
  },
  subtitle: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    textAlign: 'center',
    marginBottom: Spacing[6],
  },
  sectionTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 20,
    color: Colors.primary,
    marginBottom: Spacing[4],
  },
  input: {
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.md,
    padding: Spacing[4],
    fontFamily: Fonts.scribe,
    color: Colors.onSurface,
    fontSize: 14,
    marginBottom: Spacing[3],
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    padding: Spacing[4],
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: Spacing[2],
  },
  buttonText: {
    fontFamily: Fonts.scribe,
    color: Colors.onPrimary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  ghostButton: {
    padding: Spacing[4],
    marginTop: Spacing[4],
  },
  ghostButtonText: {
    fontFamily: Fonts.scribe,
    color: Colors.secondary,
    fontWeight: '600',
  },
  roleSelector: {
    flexDirection: 'row',
    gap: Spacing[2],
    marginBottom: Spacing[4],
  },
  roleButton: {
    flex: 1,
    padding: Spacing[2],
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    alignItems: 'center',
  },
  roleButtonActive: {
    backgroundColor: Colors.primaryContainer,
    borderColor: Colors.primary,
  },
  roleButtonText: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    textTransform: 'capitalize',
  },
  roleButtonTextActive: {
    color: Colors.onPrimaryContainer,
    fontWeight: '700',
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing[4],
  },
  switchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  switchLabel: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
  },
  userRowDeleted: {
    opacity: 0.6,
  },
  userEmail: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.onSurface,
    fontWeight: '600',
  },
  badge: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 4,
    overflow: 'hidden',
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  badge_root_admin: { backgroundColor: '#f59e0b', color: '#fff' },
  badge_admin: { backgroundColor: '#10b981', color: '#fff' },
  badge_user: { backgroundColor: '#6b7280', color: '#fff' },
  badge_deleted: { backgroundColor: Colors.error, color: '#fff' },
  actions: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  actionIcon: {
    padding: Spacing[2],
  },
  currentLabel: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    fontStyle: 'italic',
  },
  dangerZone: {
    marginTop: Spacing[8],
    borderColor: Colors.error,
    backgroundColor: 'rgba(255, 180, 171, 0.05)',
    marginBottom: Spacing[10],
  },
  dangerText: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    marginBottom: Spacing[4],
  },
  nukeButton: {
    backgroundColor: 'rgba(255, 180, 171, 0.1)',
    borderWidth: 1,
    borderColor: Colors.error,
    padding: Spacing[4],
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  nukeButtonText: {
    fontFamily: Fonts.scribe,
    color: Colors.error,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
