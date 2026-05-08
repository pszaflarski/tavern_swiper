import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import SwipeDeck from '../../components/SwipeDeck';
import ScreenHeader from '../../components/ScreenHeader';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';
import { useDiscoveryFeed, useProfiles, Profile } from '../../hooks/useProfiles';
import { useSwipe } from '../../hooks/useSwipe';
import { useUser } from '../../hooks/useUser';
import { useProfileContext } from '../../context/ProfileContext';
import { useMatch } from '../../context/MatchContext';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';

function TavernScreenInner() {
  const { user, isAuthenticated, isLoading: isLoadingUser } = useUser();
  const { 
    activeProfileId, 
    isLoadingActiveProfile, 
    refetchActiveProfile,
    profiles,
    refetchProfiles
  } = useProfileContext();
  const swipeMutation = useSwipe();
  const { showMatch } = useMatch();
  const router = useRouter();
  const [deck, setDeck] = useState<Profile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const WATERMARK = 3;

  const staleFetchCountRef = useRef(0);
  const [isBackingOff, setIsBackingOff] = useState(false);
  const deckRef = useRef<Profile[]>([]);

  // Keep ref in sync with latest deck state
  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  const { data: batch, isFetching, refetch: refetchDiscovery, dataUpdatedAt } = useDiscoveryFeed(activeProfileId, isAuthenticated, 10);
  
  // Refresh data whenever screen gains focus
  useRefreshOnFocus(React.useCallback(() => {
    refetchActiveProfile();
    refetchProfiles();
    refetchDiscovery();
  }, [refetchActiveProfile, refetchProfiles, refetchDiscovery]));

  const queryClient = useQueryClient();

  const isInitialLoad = !deck.length && isFetching;

  // Reset deck when current profile changes
  useEffect(() => {
    setDeck([]);
    setCurrentIndex(0);
    setExhausted(false);
  }, [activeProfileId]);

  // Detect when the realm is empty (API returned nothing)
  useEffect(() => {
    if (batch && batch.length === 0 && !isFetching) {
      setExhausted(true);
    }
  }, [batch, isFetching]);

  // Loading timeout effect
  useEffect(() => {
    if (isInitialLoad) {
      const timer = setTimeout(() => setLoadTimedOut(true), 8000);
      return () => clearTimeout(timer);
    }
    setLoadTimedOut(false);
  }, [isInitialLoad]);

  // Append new batches to our local deck with deduplication.
  // We use dataUpdatedAt to ensure this effect runs every time a fetch finishes,
  // even if the data is identical (fixing the referential caching loop).
  useEffect(() => {
    if (batch && batch.length > 0) {
      // Use ref to avoid stale closure of 'deck' without triggering unnecessary effect runs
      const existingIds = new Set(
        (deckRef.current || [])
          .filter(p => p && p.profile_id)
          .map(p => p.profile_id)
      );
      const newUnique = (batch || []).filter(p => p && p.profile_id && !existingIds.has(p.profile_id));
      const isUseless = deckRef.current.length > 0 && newUnique.length === 0;

      if (isUseless) {
        const nextCount = staleFetchCountRef.current + 1;
        staleFetchCountRef.current = nextCount;
        
        if (nextCount >= 5) {
          setExhausted(true);
          setIsBackingOff(false);
          // Auto-recover after 5 minutes to catch newly-added profiles
          setTimeout(() => {
            setExhausted(false);
            staleFetchCountRef.current = 0;
          }, 5 * 60 * 1000);
        } else {
          setIsBackingOff(true);
          const delay = nextCount <= 2 ? 5000 : 30000;
          setTimeout(() => setIsBackingOff(false), delay);
        }
      } else {
        // We found new heroes! Reset backoff and add them.
        staleFetchCountRef.current = 0;
        setIsBackingOff(false);
        
        if (newUnique.length > 0) {
          setDeck(prev => prev.length === 0 ? newUnique : [...prev, ...newUnique]);
        }
      }
    }
  }, [batch, activeProfileId, dataUpdatedAt]);

  const currentProfile = deck[currentIndex];

  const handleSwipeLeft = (id: string) => {
    if (!activeProfileId) return;
    swipeMutation.mutate({ swiperProfileId: activeProfileId, swipedProfileId: id, direction: 'left' });
    advanceIndex();
    setShowDetails(false);
  };

  const handleSwipeRight = (id: string) => {
    if (!activeProfileId) return;
    swipeMutation.mutate(
      { swiperProfileId: activeProfileId, swipedProfileId: id, direction: 'right' },
      {
        onSuccess: (data) => {
          if (data.match_id) {
            const swipedProfile = deck.find(p => p.profile_id === id);
            if (swipedProfile) {
              showMatch({
                profile_id: swipedProfile.profile_id,
                display_name: swipedProfile.display_name,
                image_url: swipedProfile.image_urls?.[0] || '',
              });
            }
          }
        },
      }
    );
    advanceIndex();
    setShowDetails(false);
  };

  const advanceIndex = () => {
    setCurrentIndex(prev => prev + 1);
  };

  // Watermark trigger: if we're running low on cards, summon more heroes in the background.
  // Added isBackingOff check to prevent spamming the API when we know the realm is quiet.
  useEffect(() => {
    const isRunningLow = deck.length > 0 && deck.length - currentIndex <= WATERMARK;
    if (isRunningLow && !isFetching && !exhausted && !isBackingOff) {
      refetchDiscovery();
    }
  }, [currentIndex, deck.length, isFetching, refetchDiscovery, exhausted, isBackingOff]);

  const handleRecast = () => {
    // Full reset: clear local state and all related caches
    setDeck([]);
    setCurrentIndex(0);
    setExhausted(false);
    staleFetchCountRef.current = 0;
    setIsBackingOff(false);
    queryClient.invalidateQueries({ queryKey: ['discovery'] });
    queryClient.invalidateQueries({ queryKey: ['profiles', 'me', 'active'] });
    queryClient.invalidateQueries({ queryKey: ['matches'] });
    refetchDiscovery();
  };


  if (isLoadingUser || isLoadingActiveProfile || isInitialLoad) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.headerSub}>Summoning the realm...</Text>
        {loadTimedOut && (
          <>
            <Text style={styles.emptyDesc}>The scrying spell is taking longer than expected.</Text>
            <TouchableOpacity 
              style={[styles.roundButton, { width: 'auto', paddingHorizontal: Spacing[4], height: 40, marginTop: Spacing[4] }]}
              onPress={() => { refetchDiscovery(); setLoadTimedOut(false); }}
            >
              <Text style={{ color: Colors.primary, fontFamily: Fonts.scribe }}>TRY AGAIN</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  // If authenticated but no active profile (or no profiles at all), we can't show a feed
  const hasNoProfiles = profiles && profiles.length === 0;
  if (isAuthenticated && (hasNoProfiles || !activeProfileId) && !isLoadingUser) {
    return (
      <View style={styles.container} testID="tavern-screen-no-profile">
        <ScreenHeader title="Tavern Swiper" />
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>🛡️</Text>
          <Text style={styles.emptyTitle}>{hasNoProfiles ? "Forge Your First Identity" : "Choose Your Hero"}</Text>
          <Text style={styles.emptyDesc}>
            {hasNoProfiles 
              ? "You must forge an identity before your legend can begin." 
              : "You must select an active profile to discover other heroes in the realm."}
          </Text>
          <TouchableOpacity 
            style={styles.emptyCtaButton} 
            onPress={() => router.push(hasNoProfiles ? '/profiles/create_and_edit' : '/profiles')}
            testID="forge-identity-button"
          >
            <Text style={styles.emptyCtaText}>
              {hasNoProfiles ? "FORGE NEW IDENTITY" : "SELECT ACTIVE HERO"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="tavern-screen">
      <View style={styles.deckWrapper}>
        {deck.length === 0 || currentIndex >= deck.length ? (
          <View style={styles.centered}>
             <Text style={styles.emptyIcon}>{isFetching ? "🔮" : "🌪️"}</Text>
             <Text style={styles.emptyTitle}>{isFetching ? "Scrying The Realm..." : "No Heroes Found"}</Text>
             <Text style={styles.emptyDesc}>
               {isFetching 
                 ? "Searching distant lands for more companions..." 
                 : "The realm is quiet tonight. Try again later."}
             </Text>
             {!isFetching && (
               <TouchableOpacity onPress={handleRecast} style={{ marginTop: Spacing[4] }}>
                  <Text style={{ color: Colors.primary, fontFamily: Fonts.scribe }}>RE-CAST SCRYING SPELL</Text>
               </TouchableOpacity>
             )}
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <SwipeDeck
              profiles={deck.slice(currentIndex)}
              onSwipeLeft={handleSwipeLeft}
              onSwipeRight={handleSwipeRight}
            />
          </View>
        )}
      </View>

      <ScreenHeader title="Tavern Swiper" isAbsolute />

      {deck.length > 0 && currentIndex < deck.length && (
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
      {swipeMutation.isError && (
        <View style={styles.swipeErrorBanner}>
          <Text style={styles.swipeErrorText}>
            ⚠️ Last swipe wasn't recorded. The fates may not align.
          </Text>
        </View>
      )}
    </View>
  );
}

export default function TavernScreen() {
  return (
    <ScreenErrorBoundary fallbackMessage="The tavern is currently clouded by a mysterious fog.">
      <TavernScreenInner />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
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
  emptyCtaButton: {
    width: 'auto' as any,
    paddingHorizontal: Spacing[6],
    height: 64,
    borderRadius: Radius.md,
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceContainerLowest,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadow.waxSeal,
  },
  emptyCtaText: {
    color: Colors.primary,
    fontFamily: Fonts.scribe,
    fontWeight: '600' as const,
    letterSpacing: 1,
  },
  headerSub: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    marginTop: Spacing[1],
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
    paddingHorizontal: Spacing[6],
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
    paddingTop: 80, // Respect header height
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
  swipeErrorBanner: {
    position: 'absolute',
    top: 100,
    left: Spacing[6],
    right: Spacing[6],
    backgroundColor: 'rgba(211, 47, 47, 0.9)',
    padding: Spacing[3],
    borderRadius: Radius.md,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.waxSeal,
  },
  swipeErrorText: {
    color: '#FFFFFF',
    fontFamily: Fonts.scribe,
    fontSize: 13,
    fontWeight: '600',
  },
});
