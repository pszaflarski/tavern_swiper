import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import SwipeDeck, { SwipeProfile } from '../../components/SwipeDeck';
import { Colors, Fonts, Spacing, Radius } from '../../theme';
import { useDiscovery } from '../../hooks/useDiscovery';
import { useSwipe } from '../../hooks/useSwipe';
import { useProfiles } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useActiveProfile } from '../../lib/ActiveProfileContext';

export default function TavernScreen() {
  const { user } = useUser();
  const { data: profiles, isLoading: isLoadingProfiles } = useProfiles(user?.uid);
  const [useRealData, setUseRealData] = useState(true); // Default to true now
  const { activeProfileId } = useActiveProfile();
  
  // Find the full profile object for the active ID
  const activeProfile = profiles?.find(p => p.profile_id === activeProfileId);
  const myProfileId = activeProfileId || undefined;
  
  const { data: feed, isLoading: isLoadingFeed, refetch } = useDiscovery(myProfileId);
  const swipeMutation = useSwipe(myProfileId);

  const activeProfiles = feed?.profiles || [];

  const handleSwipeLeft = (id: string) => {
    swipeMutation.mutate({ swipedProfileId: id, direction: 'left' });
  };

  const handleSwipeRight = (id: string) => {
    swipeMutation.mutate({ swipedProfileId: id, direction: 'right' });
  };

  if (isLoadingProfiles) {
    return (
      <View style={styles.centered}>
        <Text style={styles.headerSub}>Summoning your presence...</Text>
      </View>
    );
  }

  // CRITICAL: No profiles = No entry to the Tavern
  if (!profiles || profiles.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Tavern Swiper</Text>
          <Text style={styles.headerSub}>The Hero's Quest</Text>
        </View>
        <View style={[styles.centered, { padding: Spacing[10] }]} testID="tavern-empty-state">
          <Text style={styles.emptyIcon}>🪑</Text>
          <Text style={styles.emptyTitle}>The Tavern is Empty</Text>
          <Text style={styles.emptyDesc}>
            You cannot enter the Tavern without a Hero's identity. 
            Create your first profile to start discovery.
          </Text>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => router.push('/profiles')}
            testID="forge-identity-button"
          >
            <Text style={styles.actionButtonText}>Forge Your Identity</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Handle case where profiles exist but none is active (e.g. storage empty)
  if (!activeProfileId) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Tavern Swiper</Text>
          <Text style={styles.headerSub}>The Hero's Quest</Text>
        </View>
        <View style={[styles.centered, { padding: Spacing[10] }]}>
          <Text style={styles.emptyIcon}>👤</Text>
          <Text style={styles.emptyTitle}>Identity Required</Text>
          <Text style={styles.emptyDesc}>
            You have identities forged, but you must choose which one to use in the Tavern.
          </Text>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => router.push('/profiles')}
          >
            <Text style={styles.actionButtonText}>Choose Identity</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Tavern Swiper</Text>
        <Text style={styles.headerSub}>The Hero's Quest</Text>
        {activeProfile && (
          <Text style={styles.activeProfileLabel}>
            ADVENTURING AS: <Text style={{ color: Colors.tertiary }}>{activeProfile.display_name}</Text>
          </Text>
        )}
      </View>
      <View style={styles.deckWrapper}>
        {isLoadingFeed ? (
          <View style={styles.centered}>
            <Text style={styles.headerSub}>Scrying the realm...</Text>
          </View>
        ) : activeProfiles.length === 0 ? (
          <View style={styles.centered}>
             <Text style={styles.emptyIcon}>🌪️</Text>
             <Text style={styles.emptyTitle}>No Heroes Found</Text>
             <Text style={styles.emptyDesc}>The realm is quiet tonight. Try again later.</Text>
             <TouchableOpacity onPress={() => refetch()} style={{ marginTop: Spacing[4] }}>
                <Text style={{ color: Colors.primary, fontFamily: Fonts.scribe }}>RE-CAST SCRYING SPELL</Text>
             </TouchableOpacity>
          </View>
        ) : (
          <SwipeDeck
            profiles={activeProfiles}
            onSwipeLeft={handleSwipeLeft}
            onSwipeRight={handleSwipeRight}
          />
        )}
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
  },
  activeProfileLabel: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    color: Colors.outline,
    marginTop: Spacing[2],
    opacity: 0.8,
  },
  deckWrapper: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: Spacing[4],
  },
  emptyTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 24,
    color: Colors.onSurface,
    marginBottom: Spacing[2],
  },
  emptyDesc: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing[8],
  },
  actionButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing[3],
    paddingHorizontal: Spacing[8],
    borderRadius: Radius.full,
  },
  actionButtonText: {
    color: Colors.onPrimary,
    fontFamily: Fonts.heroic,
    fontSize: 16,
    fontWeight: '600',
  },
});
