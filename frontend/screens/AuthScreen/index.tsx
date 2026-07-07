import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../../theme';
import { styles } from './styles';
import DiceLoadingScreen from '../../components/DiceLoadingScreen';
import { auth } from '../../lib/firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { useUser } from '../../hooks/useUser';
import { usersApi } from '../../lib/api';
import { signInWithGoogle, statusCodes } from '../../lib/googleAuth';
import { signInWithApple, isAppleSignInAvailable } from '../../lib/appleAuth';

import { useRouter, Redirect } from 'expo-router';

export default function AuthScreen() {
  const { isAuthenticated, isLoading: authLoading } = useUser();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isAppleAvailable, setIsAppleAvailable] = useState(false);

  useEffect(() => {
    isAppleSignInAvailable()
      .then(setIsAppleAvailable)
      .catch((err) => {
        console.warn('[AuthScreen] Apple Sign-In availability check failed:', err);
        setIsAppleAvailable(false);
      });
  }, []);

  if (authLoading) {
    return <DiceLoadingScreen />;
  }

  if (isAuthenticated) {
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
        const token = await userCred.user.getIdToken();
        await usersApi.post('/users/', {
          email: userCred.user.email,
          user_type: 'user',
          is_premium: false
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
    } catch (error: any) {
      console.error('Authentication error details:', {
        code: error.code,
        message: error.message,
        name: error.name,
        stack: error.stack
      });

      let errorMessage = error.message || 'An identification error occurred.';

      // Map specific Firebase/Auth error codes
      if (error.code === 'auth/wrong-password') {
        errorMessage = 'Wrong password. Please try again.';
      } else if (error.code === 'auth/user-not-found') {
        errorMessage = 'User not found. Sign up instead?';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password should be at least 6 characters.';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many failed attempts. Please try again later.';
      } else if (error.code === 'auth/invalid-api-key' || error.code === 'auth/api-key-not-valid') {
        errorMessage = 'The authentication service configuration is invalid (API Key).';
      } else if (error.code === 'auth/operation-not-allowed') {
        errorMessage = 'Email/Password authentication is not enabled for this realm.';
      } else if (errorMessage.toLowerCase().includes('firebase')) {
        errorMessage = 'The authentication service encountered an error. Please try again.';
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
      // Navigation is handled by the useEffect/isAuthenticated check
    } catch (error: any) {
      console.error('Google Sign-In error:', error);
      
      let errorMessage = `Google sign-in failed: ${error.code || 'unknown'} - ${error.message || 'no message'}`;
      
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        errorMessage = 'Sign-in cancelled.';
      } else if (error.code === statusCodes.IN_PROGRESS) {
        errorMessage = 'Sign-in already in progress.';
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        errorMessage = 'Google Play Services not available.';
      } else if (error.message?.includes('INTERNAL_ERROR')) {
        errorMessage = 'Google Sign-In requires a Google account on this device. Please add one in Settings > Accounts first.';
      } else if (error.message?.includes('auth/account-exists-with-different-credential')) {
        errorMessage = 'An account already exists with this email. Please sign in with your password first.';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithApple();
      // Navigation is handled by the useEffect/isAuthenticated check
    } catch (error: any) {
      console.error('Apple Sign-In error:', error);
      
      let errorMessage = `Apple sign-in failed: ${error.message || 'unknown error'}`;
      if (error.message?.includes('auth/account-exists-with-different-credential')) {
        errorMessage = 'An account already exists with this email. Please sign in with your password first.';
      } else if (error.message?.includes('Canceled') || error.message?.includes('cancel')) {
        errorMessage = 'Sign-in cancelled.';
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

        <View style={isAppleAvailable ? styles.socialButtonsRow : null}>
          <Pressable
            style={({ pressed }) => [
              isAppleAvailable ? styles.googleButtonHalf : styles.googleButton,
              (loading || pressed) && styles.buttonDisabled
            ]}
            onPress={handleGoogleSignIn}
            disabled={loading}
            testID="auth-google-button"
          >
            <Ionicons name="logo-google" size={20} color="#000000" style={styles.googleIcon} />
            <Text style={[styles.googleButtonText, isAppleAvailable && { fontSize: 14 }]}>
              {isAppleAvailable ? 'Google' : 'Continue with Google'}
            </Text>
          </Pressable>

          {isAppleAvailable && (
            <Pressable
              style={({ pressed }) => [
                styles.appleButtonHalf,
                (loading || pressed) && styles.buttonDisabled
              ]}
              onPress={handleAppleSignIn}
              disabled={loading}
              testID="auth-apple-button"
            >
              <Ionicons name="logo-apple" size={20} color="#000000" style={styles.appleIcon} />
              <Text style={[styles.appleButtonText, isAppleAvailable && { fontSize: 14 }]}>
                Apple
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.dividerContainer}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.divider} />
        </View>

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
            <Pressable
              onPress={() => setIsPasswordVisible(!isPasswordVisible)}
              style={({ pressed }) => [
                styles.eyeIcon,
                pressed && { opacity: 0.7 }
              ]}
              testID="auth-password-toggle"
            >
              <Ionicons
                name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={Colors.primary}
              />
            </Pressable>
          </View>
        </View>

        {error && (
          <Text style={styles.errorText} testID="auth-error-text">
            {error}
          </Text>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            (loading || authLoading || pressed) && styles.buttonDisabled
          ]}
          onPress={handleAuth}
          disabled={loading || authLoading}
          testID="auth-submit-button"
        >
          {loading || authLoading ? (
            <ActivityIndicator color={Colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>
              {isLogin ? 'Enter Tavern' : 'Claim Your Title'}
            </Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.toggle,
            pressed && { opacity: 0.7 }
          ]}
          onPress={() => {
            setIsLogin(!isLogin);
            setError(null);
          }}
          disabled={loading}
          testID="auth-toggle-link"
        >
          <Text style={styles.toggleText}>
            {isLogin
              ? "New to the realm? Sign up instead"
              : "Already have a title? Log in here"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

