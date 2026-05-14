import React from 'react';
import { View, Text, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import SwipeDeck from '../../components/SwipeDeck';
import ScreenHeader from '../../components/ScreenHeader';
import { Colors, Fonts, Spacing } from '../../theme';
import { useUser } from '../../hooks/useUser';
import { useProfileContext } from '../../context/ProfileContext';
import { useDiscoveryDeck } from './useDiscoveryDeck';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { styles } from './styles';

function TavernScreenInner() {
  const { user, isAuthenticated, isLoading: isLoadingUser } = useUser();
  const { 
    activeProfileId, 
    isLoadingActiveProfile, 
    isLoadingProfiles,
    refetchActiveProfile,
    profiles,
    refetchProfiles
  } = useProfileContext();
  const router = useRouter();
  const {
    deck,
    currentIndex,
    currentProfile,
    showDetails,
    setShowDetails,
    exhausted,
    loadTimedOut,
    setLoadTimedOut,
    isInitialLoad,
    isFetching,
    refetchDiscovery,
    handleSwipeLeft,
    handleSwipeRight,
    handleRecast,
    swipeError,
  } = useDiscoveryDeck(activeProfileId, isAuthenticated);

  // Refresh data whenever screen gains focus
  useRefreshOnFocus(React.useCallback(() => {
    refetchActiveProfile();
    refetchProfiles();
    refetchDiscovery();
  }, [refetchActiveProfile, refetchProfiles, refetchDiscovery]));


  if (isLoadingUser || isLoadingActiveProfile || isLoadingProfiles || isInitialLoad) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.headerSub}>Summoning the realm...</Text>
        {loadTimedOut && (
          <>
            <Text style={styles.emptyDesc}>The scrying spell is taking longer than expected.</Text>
            <Pressable 
              style={({ pressed }) => [
                styles.roundButton, 
                { width: 'auto', paddingHorizontal: Spacing[4], height: 40, marginTop: Spacing[4] },
                pressed && { opacity: 0.7 }
              ]}
              onPress={() => { refetchDiscovery(); setLoadTimedOut(false); }}
            >
              <Text style={{ color: Colors.primary, fontFamily: Fonts.scribe }}>TRY AGAIN</Text>
            </Pressable>
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
          <Pressable 
            style={({ pressed }) => [styles.emptyCtaButton, pressed && { opacity: 0.7 }]} 
            onPress={() => router.push((hasNoProfiles ? '/profiles/form' : '/profiles') as any)}
            testID="forge-identity-button"
          >
            <Text style={styles.emptyCtaText}>
              {hasNoProfiles ? "FORGE NEW IDENTITY" : "SELECT ACTIVE HERO"}
            </Text>
          </Pressable>
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
               <Pressable onPress={handleRecast} style={({ pressed }) => [{ marginTop: Spacing[4] }, pressed && { opacity: 0.7 }]}>
                  <Text style={{ color: Colors.primary, fontFamily: Fonts.scribe }}>RE-CAST SCRYING SPELL</Text>
               </Pressable>
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
                <Text style={styles.detailsBio}>
                  {currentProfile?.bio || "This hero's story is yet to be written in the annals of the realm."}
                </Text>
                {currentProfile?.gender && (
                   <>
                    <View style={styles.divider} />
                    <Text style={styles.detailsLabel}>Attributes</Text>
                    <Text style={styles.detailsBio}>Gender: {currentProfile.gender.map(t => t.name).join(', ')}</Text>
                   </>
                )}
                {/* Spacer for the footer area to ensure text isn't cut off by buttons */}
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
              onPress={() => currentProfile && handleSwipeLeft(currentProfile.profile_id)}
              testID="swipe-left-button"
              disabled={!activeProfileId}
            >
              <Text style={[styles.roundButtonText, { color: Colors.error }]}>✕</Text>
            </Pressable>
            <Pressable 
              style={({ pressed }) => [
                styles.roundButton, 
                { borderColor: Colors.tertiary, transform: [{ scale: 1.2 }] },
                pressed && { opacity: 0.7 }
              ]} 
              onPress={() => currentProfile && handleSwipeRight(currentProfile.profile_id)}
              testID="swipe-right-button"
              disabled={!activeProfileId}
            >
              <Text style={[styles.roundButtonText, { color: Colors.tertiary }]}>❤️</Text>
            </Pressable>
          </View>
        </>
      )}
      {swipeError && (
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

