import React from 'react';
import { View, Text, StyleSheet, FlatList, Image, ActivityIndicator } from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';
import { useActiveProfile } from '../../lib/ActiveProfileContext';
import { useMatches, MatchOut } from '../../hooks/useSwipe';
import { useProfile } from '../../hooks/useProfiles';

function MatchItem({ match, activeProfileId }: { match: MatchOut; activeProfileId: string }) {
  const otherProfileId = match.profile_id_a === activeProfileId ? match.profile_id_b : match.profile_id_a;
  const { data: profile, isLoading } = useProfile(otherProfileId);

  if (isLoading) {
    return (
      <View style={styles.matchItemLoading}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  if (!profile) return null;

  return (
    <View style={styles.matchItem}>
      <View style={styles.matchAvatarContainer}>
        {profile.image_url ? (
          <Image source={{ uri: profile.image_url }} style={styles.matchAvatar} />
        ) : (
          <Text style={{ fontSize: 20 }}>🛡️</Text>
        )}
      </View>
      <View style={styles.matchInfo}>
        <Text style={styles.matchName}>{profile.display_name}</Text>
        <Text style={styles.matchClass}>{profile.character_class}</Text>
      </View>
      <View style={styles.matchAction}>
        <Text style={styles.scrollIcon}>📜</Text>
      </View>
    </View>
  );
}

export default function ScrollsScreen() {
  const { activeProfileId } = useActiveProfile();
  const { data: matches, isLoading } = useMatches(activeProfileId || undefined);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Quest Log</Text>
        <Text style={styles.headerSub}>Your magical connections</Text>
      </View>
      
      {!activeProfileId ? (
        <View style={styles.centered}>
          <Text style={styles.icon}>❓</Text>
          <Text style={styles.emptyTitle}>Identity Required</Text>
          <Text style={styles.emptySubtitle}>Select a profile to see your matches.</Text>
        </View>
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : matches && matches.length > 0 ? (
        <FlatList
          data={matches}
          keyExtractor={(m) => m.match_id}
          renderItem={({ item }) => <MatchItem match={item} activeProfileId={activeProfileId} />}
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <View style={styles.centered}>
          <Text style={styles.icon}>📜</Text>
          <Text style={styles.emptyTitle}>The scrolls are empty...</Text>
          <Text style={styles.emptySubtitle}>Start swiping in the Tavern to find fellow heroes.</Text>
        </View>
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
    paddingTop: Spacing[16],
    paddingBottom: Spacing[4],
    paddingHorizontal: Spacing[6],
    backgroundColor: Colors.surfaceContainerLowest,
  },
  headerTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 24,
    fontWeight: '700',
    color: Colors.primary,
  },
  headerSub: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    textTransform: 'uppercase',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[10],
    gap: Spacing[3],
  },
  icon: {
    fontSize: 64,
  },
  emptyTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 20,
    color: Colors.onSurface,
  },
  emptySubtitle: {
    fontFamily: Fonts.scribe,
    fontSize: 15,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
  },
  listContent: {
    padding: Spacing[6],
    gap: Spacing[4],
  },
  matchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLow,
    padding: Spacing[4],
    borderRadius: Radius.lg,
    ...Shadow.waxSeal,
  },
  matchItemLoading: {
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
  },
  matchAvatarContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.surfaceContainerHighest,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  matchAvatar: {
    width: '100%',
    height: '100%',
  },
  matchInfo: {
    flex: 1,
    marginLeft: Spacing[4],
  },
  matchName: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.onSurface,
  },
  matchClass: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    textTransform: 'uppercase',
  },
  matchAction: {
    padding: Spacing[2],
  },
  scrollIcon: {
    fontSize: 20,
    opacity: 0.6,
  },
});
