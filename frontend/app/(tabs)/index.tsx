import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import SwipeDeck, { SwipeProfile } from '../../components/SwipeDeck';
import { Colors, Fonts, Spacing } from '../../theme';
import { useDiscovery } from '../../hooks/useDiscovery';
import { useSwipe } from '../../hooks/useSwipe';

const DEMO_PROFILES: SwipeProfile[] = [
  {
    profile_id: '1',
    display_name: 'Lagra the Valiant',
    tagline: 'Seeker of adventure and good ale.',
    character_class: 'Ranger',
    realm: 'Fort Tavern',
    talents: ['Archery', 'Herbalism', 'Cartography', 'Brewing'],
    image_url: undefined,
  },
  {
    profile_id: '2',
    display_name: 'Iryn the Arcane',
    tagline: 'My love language is interesting curses.',
    character_class: 'Mage',
    realm: 'The Amber Spire',
    talents: ['Alchemy', 'Stargazing', 'Ancient Lore', 'Chess'],
    image_url: undefined,
  },
];

export default function TavernScreen() {
  const [useRealData, setUseRealData] = useState(false); // Toggle this to true once backend is live
  const [demoProfiles, setDemoProfiles] = useState(DEMO_PROFILES);

  // Backend integration
  const myProfileId = 'my-profile-1'; // Replace with actual profile selection logic
  const { data: feed, isLoading } = useDiscovery(myProfileId);
  const swipeMutation = useSwipe(myProfileId);

  const activeProfiles = useRealData ? (feed as any as SwipeProfile[]) || [] : demoProfiles;

  const handleSwipeLeft = (id: string) => {
    if (useRealData) {
      swipeMutation.mutate({ swipedProfileId: id, direction: 'left' });
    } else {
      setDemoProfiles((p) => p.filter((item) => item.profile_id !== id));
    }
  };

  const handleSwipeRight = (id: string) => {
    if (useRealData) {
      swipeMutation.mutate({ swipedProfileId: id, direction: 'right' });
    } else {
      setDemoProfiles((p) => p.filter((item) => item.profile_id !== id));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Trystr</Text>
        <Text style={styles.headerSub}>The Hero's Quest</Text>
        <Text 
          style={{ fontSize: 10, color: Colors.outline, marginTop: 4, opacity: 0.6 }}
          onPress={() => setUseRealData(!useRealData)}
        >
          {useRealData ? '🔮 SCRIBING LIVE REALM' : '📜 READING ANCIENT DEMO'} (Toggle)
        </Text>
      </View>
      <View style={styles.deckWrapper}>
        {isLoading && useRealData ? (
          <View style={styles.centered}><Text style={styles.headerSub}>Scrying the realm...</Text></View>
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
  deckWrapper: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
