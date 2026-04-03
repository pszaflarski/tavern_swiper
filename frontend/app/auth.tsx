import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../theme';
import { auth } from '../lib/firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from '@firebase/auth';
import { useUser } from '../hooks/useUser';
import { usersApi } from '../lib/api';

import { Stack, useRouter, Redirect } from 'expo-router';

export default function AuthScreen() {
  const { isAuthenticated, isLoading: authLoading } = useUser();
  const router = useRouter();

  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  // --- Navigation Guards ---
  // If authenticated, drop the user straight into the Tavern tabs.
  // Declarative redirection is more reliable for strict E2E checks.
  // CRITICAL: This must be BELOW all hook declarations to avoid rule violations.
  if (!authLoading && isAuthenticated) {
    console.log('[AUTH DEBUG] Declarative Redirection to /(tabs)...');
    return <Redirect href="/(tabs)" />;
  }

  const handleAuth = async () => {
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        // Standard registration always defaults to 'user' type in backend, 
        // root admin must be claimed via /admin.
        await usersApi.post('/users/', {
          email: userCred.user.email,
          user_type: 'user',
          is_premium: false
        });
      }
    } catch (error: any) {
      console.error(error);
      let errorMessage = error.message;
      if (error.code === 'auth/wrong-password') {
        errorMessage = 'Wrong password. Please try again.';
      } else if (error.code === 'auth/user-not-found') {
        errorMessage = 'User not found. Sign up instead?';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password should be at least 6 characters.';
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.card}>
        <Text style={styles.title}>
          {isLogin ? 'Sign In' : 'Begin Your Quest'}
        </Text>
        <Text style={styles.subtitle}>
          {isLogin
            ? 'Enter the tavern to continue your journey.'
            : 'Join the ranks of heroes seeking companionship.'}
        </Text>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="hero@realm.com"
            placeholderTextColor={Colors.outlineVariant}
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              setError(null);
            }}
            autoCapitalize="none"
            keyboardType="email-address"
            testID="auth-email-input"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordContainer}>
            <TextInput
              style={[styles.input, styles.passwordInput]}
              placeholder="••••••••"
              placeholderTextColor={Colors.outlineVariant}
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setError(null);
              }}
              secureTextEntry={!isPasswordVisible}
              testID="auth-password-input"
            />
            <TouchableOpacity
              onPress={() => setIsPasswordVisible(!isPasswordVisible)}
              style={styles.eyeIcon}
              testID="auth-password-toggle"
            >
              <Ionicons
                name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={Colors.primary}
              />
            </TouchableOpacity>
          </View>
        </View>

        {error && (
          <Text style={styles.errorText} testID="auth-error-text">
            {error}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.button, (loading || authLoading) && styles.buttonDisabled]}
          onPress={handleAuth}
          disabled={loading || authLoading}
          testID="auth-submit-button"
          accessibilityRole="button"
        >
          {loading || authLoading ? (
            <ActivityIndicator color={Colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>
              {isLogin ? 'Enter Tavern' : 'Claim Your Title'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toggle}
          onPress={() => {
            setIsLogin(!isLogin);
            setError(null);
          }}
          disabled={loading}
          testID="auth-toggle-link"
          accessibilityRole="link"
        >
          <Text style={styles.toggleText}>
            {isLogin
              ? "New to the realm? Sign up instead"
              : "Already have a title? Log in here"}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    padding: Spacing[6],
  },
  card: {
    backgroundColor: Colors.surfaceContainerLowest,
    padding: Spacing[8],
    borderRadius: Radius.xl,
    ...Shadow.waxSeal,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  title: {
    fontFamily: Fonts.heroic,
    fontSize: 32,
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: Spacing[2],
  },
  subtitle: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    textAlign: 'center',
    marginBottom: Spacing[8],
  },
  inputContainer: {
    marginBottom: Spacing[4],
  },
  label: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing[1],
    marginLeft: Spacing[1],
  },
  input: {
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.md,
    padding: Spacing[4],
    fontFamily: Fonts.scribe,
    color: Colors.onSurface,
    fontSize: 16,
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderRadius: Radius.md,
  },
  passwordInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  eyeIcon: {
    paddingHorizontal: Spacing[3],
  },
  errorText: {
    fontFamily: Fonts.scribe,
    color: Colors.error,
    fontSize: 14,
    textAlign: 'center',
    marginTop: Spacing[2],
    marginBottom: Spacing[2],
  },
  button: {
    backgroundColor: Colors.primary,
    padding: Spacing[4],
    borderRadius: Radius.full,
    alignItems: 'center',
    marginTop: Spacing[4],
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontFamily: Fonts.scribe,
    color: Colors.onPrimary,
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  toggle: {
    marginTop: Spacing[6],
    alignItems: 'center',
  },
  toggleText: {
    fontFamily: Fonts.scribe,
    color: Colors.secondary,
    fontSize: 14,
    fontWeight: '600',
  },
});
