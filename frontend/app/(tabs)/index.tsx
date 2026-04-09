import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import SwipeDeck from '../../components/SwipeDeck';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';
import { useDiscoveryFeed, useProfiles } from '../../hooks/useProfiles';
import { useSwipe } from '../../hooks/useSwipe';
import { useUser } from '../../hooks/useUser';
import { useProfileContext } from '../../context/ProfileContext';

export default function TavernScreen() {
  const { user, isAuthenticated, isLoading: isLoadingUser } = useUser();
  const { activeProfileId, isLoadingActiveProfile } = useProfileContext();
  const { data: allProfiles, isLoading: isLoadingFeed, refetch } = useDiscoveryFeed(activeProfileId, isAuthenticated, 5);
  const { data: myProfiles } = useProfiles(user?.uid);
  
  const swipeMutation = useSwipe();
  const router = useRouter();

  // Show all profiles (including user's own) as requested
  const activeProfiles = useMemo(() => {
    return allProfiles ?? [];
  }, [allProfiles]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  // Reset the index ONLY when the feed is initially loaded or transitions from empty to having data
  const lastProfileCount = React.useRef(0);
  useEffect(() => {
    const currentCount = allProfiles?.length ?? 0;
    if (lastProfileCount.current === 0 && currentCount > 0) {
      setCurrentIndex(0);
    }
    lastProfileCount.current = currentCount;
  }, [allProfiles]);

  const currentProfile = activeProfiles[currentIndex];

  const handleSwipeLeft = (id: string) => {
    if (!activeProfileId) return; // Cannot swipe without a profile
    swipeMutation.mutate({ swiperProfileId: activeProfileId, swipedProfileId: id, direction: 'left' });
    setCurrentIndex(prev => prev + 1);
    setShowDetails(false); // Close details on swipe
  };

  const handleSwipeRight = (id: string) => {
    if (!activeProfileId) return; // Cannot swipe without a profile
    swipeMutation.mutate({ swiperProfileId: activeProfileId, swipedProfileId: id, direction: 'right' });
    setCurrentIndex(prev => prev + 1);
    setShowDetails(false); // Close details on swipe
  };


  if (isLoadingUser || isLoadingActiveProfile || (isLoadingFeed && !allProfiles)) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.headerSub}>Summoning the realm...</Text>
      </View>
    );
  }

  // If authenticated but no active profile, we can't show a feed
  if (isAuthenticated && !activeProfileId && !isLoadingUser) {
    return (
      <View style={styles.container} testID="tavern-screen-no-profile">
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Tavern Swiper</Text>
          <Text style={styles.headerSub}>The Hero's Quest</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>🛡️</Text>
          <Text style={styles.emptyTitle}>Create Your Hero</Text>
          <Text style={styles.emptyDesc}>You must have an active profile to discover other heroes in the realm.</Text>
          <TouchableOpacity 
            style={[styles.roundButton, { width: 'auto', paddingHorizontal: Spacing[6], borderRadius: Radius.md }]} 
            onPress={() => router.push('/profiles/create_and_edit')}
            testID="forge-identity-button"
          >
            <Text style={{ color: Colors.primary, fontFamily: Fonts.scribe }}>FORGE NEW IDENTITY</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="tavern-screen">
      <View style={styles.deckWrapper}>
        {activeProfiles.length === 0 || currentIndex >= activeProfiles.length ? (
          <View style={styles.centered}>
             <Text style={styles.emptyIcon}>🌪️</Text>
             <Text style={styles.emptyTitle}>No Heroes Found</Text>
             <Text style={styles.emptyDesc}>The realm is quiet tonight. Try again later.</Text>
             <TouchableOpacity onPress={() => refetch()} style={{ marginTop: Spacing[4] }}>
                <Text style={{ color: Colors.primary, fontFamily: Fonts.scribe }}>RE-CAST SCRYING SPELL</Text>
             </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <SwipeDeck
              profiles={activeProfiles.slice(currentIndex)}
              onSwipeLeft={handleSwipeLeft}
              onSwipeRight={handleSwipeRight}
            />
          </View>
        )}
      </View>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Tavern Swiper</Text>
        <Text style={styles.headerSub}>The Hero's Quest</Text>
      </View>

      {activeProfiles.length > 0 && currentIndex < activeProfiles.length && (
        <>
          {showDetails && (
            <View style={styles.detailsOverlay}>
              <ScrollView 
                style={styles.detailsScroll}
                contentContainerStyle={styles.detailsContent}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.detailsName}>{currentProfile?.display_name}</Text>
                {currentProfile?.tagline && (
                  <Text style={styles.detailsTagline}>"{currentProfile.tagline}"</Text>
                )}
                <View style={styles.divider} />
                <Text style={styles.detailsLabel}>The Legend</Text>
                <Text style={styles.detailsBio}>
                  {currentProfile?.bio || "This hero's story is yet to be written in the annals of the realm."}
                </Text>
                {currentProfile?.gender && (
                   <>
                    <View style={styles.divider} />
                    <Text style={styles.detailsLabel}>Attributes</Text>
                    <Text style={styles.detailsBio}>Gender: {currentProfile.gender}</Text>
                   </>
                )}
                {/* Spacer for the footer area to ensure text isn't cut off by buttons */}
                <View style={{ height: 160 }} />
              </ScrollView>
            </View>
          )}

          <TouchableOpacity 
            style={styles.infoButton} 
            onPress={() => setShowDetails(!showDetails)} 
            testID="profile-info-button"
            activeOpacity={0.7}
          >
            <Ionicons 
              name={showDetails ? "close-circle-outline" : "information-circle-outline"} 
              size={28} 
              color={Colors.onSurface} 
            />
          </TouchableOpacity>
          <View style={styles.actionRow}>
            <TouchableOpacity 
              style={[styles.roundButton, { borderColor: Colors.error }]} 
              onPress={() => currentProfile && handleSwipeLeft(currentProfile.profile_id)}
              testID="swipe-left-button"
              disabled={!activeProfileId}
            >
              <Text style={[styles.roundButtonText, { color: Colors.error }]}>✕</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.roundButton, { borderColor: Colors.tertiary, transform: [{ scale: 1.2 }] }]} 
              onPress={() => currentProfile && handleSwipeRight(currentProfile.profile_id)}
              testID="swipe-right-button"
              disabled={!activeProfileId}
            >
              <Text style={[styles.roundButtonText, { color: Colors.tertiary }]}>❤️</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Spacing[10], // Increased for status bar space
    paddingBottom: Spacing[4],
    paddingHorizontal: Spacing[6],
    backgroundColor: 'rgba(13, 17, 15, 0.7)', // Frosted glass effect
    alignItems: 'center',
    zIndex: 10,
  },
  headerTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 24,
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
    marginTop: Spacing[1],
  },
  deckWrapper: {
    ...StyleSheet.absoluteFillObject,
    bottom: 0,
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
  actionRow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing[10],
    paddingTop: Spacing[6],
    paddingBottom: Spacing[10],
    backgroundColor: 'transparent', // Overlay on top of image
    zIndex: 10,
  },
  roundButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    backgroundColor: Colors.surfaceContainerLowest,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadow.waxSeal,
  },
  roundButtonText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  infoButton: {
    position: 'absolute',
    bottom: 44, // Moved down to align with the bottom edge of the action buttons
    right: Spacing[6],
    zIndex: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)', // Subtle background for the icon
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(13, 17, 15, 0.9)', // Deep dark grimoire tint
    zIndex: 5,
    paddingTop: 120, // Respect header height
  },
  detailsScroll: {
    flex: 1,
  },
  detailsContent: {
    paddingHorizontal: Spacing[6],
    paddingBottom: Spacing[10],
  },
  detailsName: {
    fontFamily: Fonts.heroic,
    fontSize: 32,
    color: Colors.primary,
    marginBottom: Spacing[1],
  },
  detailsTagline: {
    fontFamily: Fonts.scribe,
    fontSize: 16,
    fontStyle: 'italic',
    color: Colors.tertiary,
    marginBottom: Spacing[6],
  },
  detailsLabel: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 2,
    color: Colors.outline,
    marginBottom: Spacing[2],
  },
  detailsBio: {
    fontFamily: Fonts.scribe,
    fontSize: 16,
    lineHeight: 24,
    color: Colors.onSurface,
    marginBottom: Spacing[6],
  },
  divider: {
    height: 1,
    backgroundColor: Colors.outlineVariant,
    width: '100%',
    marginVertical: Spacing[6],
    opacity: 0.3,
  },
});
