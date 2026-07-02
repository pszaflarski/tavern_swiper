import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';

import SwipeDeck from '../../components/SwipeDeck';
import ScreenHeader from '../../components/ScreenHeader';
import DiceLoadingScreen from '../../components/DiceLoadingScreen';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { Colors, Spacing } from '../../theme';
import { useUser } from '../../hooks/useUser';
import { useSharedProfile, useUnshareProfile, useClaimProfile } from '../../hooks/useProfiles';
import { styles } from './styles';

function SharedProfileScreenInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated } = useUser();

  const { data: profile, isLoading, isError } = useSharedProfile(id);
  const unshareMutation = useUnshareProfile();
  const claimMutation = useClaimProfile();

  const [showDetails, setShowDetails] = useState(false);
  const [isBanished, setIsBanished] = useState(false);
  const [isClaimed, setIsClaimed] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);

  const handleSwipeLeft = async () => {
    if (actionInProgress) return;
    setActionInProgress(true);
    unshareMutation.mutate(id as string, {
      onSuccess: () => {
        setIsBanished(true);
        setActionInProgress(false);
        Toast.show({
          type: 'success',
          text1: 'Legend Banished',
          text2: 'The shared link has been deactivated.',
        });
      },
      onError: (err: any) => {
        setActionInProgress(false);
        Toast.show({
          type: 'error',
          text1: 'Magic Failed',
          text2: err.message || 'Could not banish this identity.',
        });
      }
    });
  };

  const handleSwipeRight = async () => {
    if (actionInProgress) return;
    setActionInProgress(true);

    if (isAuthenticated) {
      claimMutation.mutate(id as string, {
        onSuccess: () => {
          setIsClaimed(true);
          setActionInProgress(false);
        },
        onError: (err: any) => {
          setActionInProgress(false);
          Toast.show({
            type: 'error',
            text1: 'Claim Failed',
            text2: err.message || 'Could not claim this identity.',
          });
        }
      });
    } else {
      try {
        await AsyncStorage.setItem('pending_claim_profile_id', id as string);
        Toast.show({
          type: 'info',
          text1: 'Enter the Tavern',
          text2: 'You must log in or sign up to claim this legend.',
          visibilityTime: 3000,
        });
        setTimeout(() => {
          setActionInProgress(false);
          router.replace('/auth');
        }, 2000);
      } catch (err) {
        setActionInProgress(false);
        console.error('AsyncStorage error:', err);
      }
    }
  };

  if (isLoading || actionInProgress) {
    return <DiceLoadingScreen message={actionInProgress ? "Channelling magic..." : "Seeking the shared identity..."} />;
  }

  if (isError || !profile) {
    return (
      <View style={styles.centered} testID="shared-profile-error">
        <Text style={styles.emptyIcon}>🌫️</Text>
        <Text style={styles.emptyTitle}>This Legend Has Faded</Text>
        <Text style={styles.emptyDesc}>
          The link may have expired, or the owner has deactivated the sharing spell for this identity.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.emptyCtaButton, pressed && { opacity: 0.7 }]}
          onPress={() => router.replace('/(tabs)' as any)}
        >
          <Text style={styles.emptyCtaText}>RETURN TO TAVERN</Text>
        </Pressable>
      </View>
    );
  }

  if (isBanished) {
    return (
      <View style={styles.centered} testID="shared-profile-banished">
        <Text style={styles.emptyIcon}>⚔️</Text>
        <Text style={styles.emptyTitle}>Legend Banished</Text>
        <Text style={styles.emptyDesc}>
          You have banished the legend of {profile.display_name}. The sharing link is now deactivated.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.emptyCtaButton, pressed && { opacity: 0.7 }]}
          onPress={() => router.replace('/(tabs)' as any)}
        >
          <Text style={styles.emptyCtaText}>RETURN TO TAVERN</Text>
        </Pressable>
      </View>
    );
  }

  if (isClaimed) {
    return (
      <View style={styles.centered} testID="shared-profile-claimed">
        <Text style={styles.emptyIcon}>🛡️</Text>
        <Text style={styles.emptyTitle}>Identity Claimed</Text>
        <Text style={styles.emptyDesc}>
          The legend of {profile.display_name} has joined your ranks! You can find and customize this identity in your archives.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.emptyCtaButton, pressed && { opacity: 0.7 }]}
          onPress={() => router.replace('/profiles' as any)}
        >
          <Text style={styles.emptyCtaText}>VIEW YOUR PROFILES</Text>
        </Pressable>
      </View>
    );
  }

  const deckProfiles = [profile];

  return (
    <View style={styles.container} testID="shared-profile-screen">
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.deckWrapper}>
        <SwipeDeck
          profiles={deckProfiles}
          onSwipeLeft={handleSwipeLeft}
          onSwipeRight={handleSwipeRight}
        />
      </View>

      <ScreenHeader title="Shared Identity" isAbsolute />

      {showDetails && (
        <View style={styles.detailsOverlay}>
          <ScrollView
            style={styles.detailsScroll}
            contentContainerStyle={styles.detailsContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.detailsName}>{profile.display_name}</Text>
            {profile.tagline && (
              <Text style={styles.detailsTagline}>"{profile.tagline}"</Text>
            )}
            <View style={styles.divider} />
            <Text style={styles.detailsBio}>
              {profile.bio || "This hero's story is yet to be written in the annals of the realm."}
            </Text>
            {profile.gender && profile.gender.length > 0 && (
              <>
                <View style={styles.divider} />
                <Text style={styles.detailsLabel}>Attributes</Text>
                <Text style={styles.detailsBio}>Gender: {profile.gender.map(t => t.name).join(', ')}</Text>
              </>
            )}
            {profile.race && profile.race.length > 0 && (
              <Text style={styles.detailsBio}>Race: {profile.race.map(t => t.name).join(', ')}</Text>
            )}
            {profile.fandom && profile.fandom.length > 0 && (
              <Text style={styles.detailsBio}>Fandom: {profile.fandom.map(t => t.name).join(', ')}</Text>
            )}
            <View style={{ height: 160 }} />
          </ScrollView>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [
          styles.infoButton,
          pressed && { opacity: 0.7 }
        ]}
        onPress={() => setShowDetails(!showDetails)}
        testID="profile-info-button"
      >
        <Ionicons
          name={showDetails ? "close-circle-outline" : "information-circle-outline"}
          size={28}
          color={Colors.onSurface}
        />
      </Pressable>

      <View style={styles.actionRow}>
        <Pressable
          style={({ pressed }) => [
            styles.roundButton,
            { borderColor: Colors.error },
            pressed && { opacity: 0.7 }
          ]}
          onPress={handleSwipeLeft}
          testID="swipe-left-button"
        >
          <Text style={[styles.roundButtonText, { color: Colors.error }]}>✕</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.roundButton,
            { borderColor: Colors.tertiary, transform: [{ scale: 1.2 }] },
            pressed && { opacity: 0.7 }
          ]}
          onPress={handleSwipeRight}
          testID="swipe-right-button"
        >
          <Text style={[styles.roundButtonText, { color: Colors.tertiary }]}>❤️</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function SharedProfileScreen() {
  return (
    <ScreenErrorBoundary fallbackMessage="The shared profile scrying mirror is clouded.">
      <SharedProfileScreenInner />
    </ScreenErrorBoundary>
  );
}
