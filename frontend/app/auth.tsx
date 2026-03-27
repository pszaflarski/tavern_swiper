import React, { useState } from 'react';
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
import { Colors, Fonts, Spacing, Radius, Shadow } from '../theme';
import { auth } from '../lib/firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';

export default function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuth = async () => {
    if (!email || !password || (!isLogin && !fullName)) {
      Alert.alert('Missing Info', 'Please fill in all fields.');
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: fullName });
      }
    } catch (error: any) {
      console.error(error);
      Alert.alert('Authentication Failed', error.message);
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
        <Text style={styles.title}>{isLogin ? 'Sign In' : 'Begin Your Quest'}</Text>
        <Text style={styles.subtitle}>
          {isLogin
            ? 'Enter the tavern to continue your journey.'
            : 'Join the ranks of heroes seeking companionship.'}
        </Text>

        {!isLogin && (
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Your Hero's Name"
              placeholderTextColor={Colors.outlineVariant}
              value={fullName}
              onChangeText={setFullName}
            />
          </View>
        )}

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="hero@realm.com"
            placeholderTextColor={Colors.outlineVariant}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={Colors.outlineVariant}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleAuth}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>{isLogin ? 'Enter Tavern' : 'Claim Your Title'}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toggle}
          onPress={() => setIsLogin(!isLogin)}
          disabled={loading}
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
