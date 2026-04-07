import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, Image, TouchableOpacity, ScrollView } from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';
import { Ionicons } from '@expo/vector-icons';

// Mock Data
const MOCK_MY_PROFILES = [
  { id: '1', name: 'Alaric the Brave', image: require('../../assets/images/placeholder/hero1.jpeg') },
  { id: '2', name: 'Lyra Moonshadow', image: require('../../assets/images/placeholder/hero2.jpg') },
  { id: '3', name: 'Valerius Darkheart', image: require('../../assets/images/placeholder/hero3.png') },
];

const MOCK_NEW_MATCHES = [
  { id: 'm1', name: 'Elora', image: require('../../assets/images/placeholder/hero4.png') },
  { id: 'm2', name: 'Kaelen', image: require('../../assets/images/placeholder/hero5.jpeg') },
  { id: 'm3', name: 'Saria', image: require('../../assets/images/placeholder/hero6.jpeg') },
  { id: 'm4', name: 'Bryn', image: require('../../assets/images/placeholder/hero1.jpeg') },
  { id: 'm5', name: 'Lia', image: require('../../assets/images/placeholder/hero2.jpg') },
];

const MOCK_INBOX = [
  { id: 'c1', name: 'Thorne', image: require('../../assets/images/placeholder/hero3.png'), lastMessage: 'The ancient caves are deep and dark, but we shall find the light.' },
  { id: 'c2', name: 'Seraphina', image: require('../../assets/images/placeholder/hero4.png'), lastMessage: 'I have found the artifact you seek. Meet me at the crossroads at dusk.' },
  { id: 'c3', name: 'Grommash', image: require('../../assets/images/placeholder/hero5.jpeg'), lastMessage: 'Prepare for battle. The orcs are gathering at the northern wall.' },
  { id: 'c4', name: 'Isolde', image: require('../../assets/images/placeholder/hero6.jpeg'), lastMessage: 'Our fate is written in the stars, yet we must walk the earth.' },
];

export default function MessagesScreen() {
  const [selectedProfileId, setSelectedProfileId] = useState(MOCK_MY_PROFILES[0].id);
  const selectedProfile = MOCK_MY_PROFILES.find(p => p.id === selectedProfileId);

  return (
    <View style={styles.container} testID="messages-screen">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        <Text style={styles.headerSub}>Scrolls & Missives</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Tabs Section */}
        <View style={styles.profileTabsContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.profileTabsContent}>
            {MOCK_MY_PROFILES.map((profile) => (
              <TouchableOpacity 
                key={profile.id} 
                onPress={() => setSelectedProfileId(profile.id)}
                style={[
                  styles.profileTab, 
                  selectedProfileId === profile.id && styles.activeProfileTab
                ]}
              >
                <Image source={profile.image} style={styles.profileTabImage} />
                <View style={[styles.profileTabOverlay, selectedProfileId === profile.id && styles.activeProfileTabOverlay]}>
                  <Text 
                    style={[styles.profileTabName, selectedProfileId === profile.id && styles.activeProfileTabName]}
                    numberOfLines={1}
                  >
                    {profile.name}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* New Matches Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>New Visions for {selectedProfile?.name}</Text>
        </View>
        <View style={styles.newMatchesContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.newMatchesContent}>
            {MOCK_NEW_MATCHES.map((match) => (
              <TouchableOpacity key={match.id} style={styles.newMatchItem}>
                <Image source={match.image} style={styles.newMatchImage} />
                <Text style={styles.newMatchName}>{match.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Inbox Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Inbox</Text>
        </View>
        <View style={styles.inboxContainer}>
          {MOCK_INBOX.map((convo) => (
            <TouchableOpacity key={convo.id} style={styles.inboxItem}>
              <View style={styles.inboxContent}>
                <Image source={convo.image} style={styles.inboxBanner} resizeMode="cover" />
                <View style={styles.inboxTextContainer}>
                  <Text style={styles.inboxName}>{convo.name}</Text>
                  <Text style={styles.inboxLastMessage} numberOfLines={1}>{convo.lastMessage}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
        
        {/* Footer Padding */}
        <View style={{ height: Spacing[20] }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    paddingTop: Spacing[8],
    paddingBottom: Spacing[2],
    paddingHorizontal: Spacing[6],
    backgroundColor: Colors.surfaceContainerLowest,
    alignItems: 'center',
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
  profileTabsContainer: {
    backgroundColor: Colors.surfaceContainerLowest,
    paddingVertical: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
  },
  profileTabsContent: {
    paddingHorizontal: Spacing[6],
    gap: Spacing[4],
  },
  profileTab: {
    height: 100,
    aspectRatio: 9 / 16,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 2,
    borderColor: 'transparent',
    ...Shadow.waxSeal,
  },
  activeProfileTab: {
    borderColor: Colors.tertiary,
  },
  profileTabImage: {
    width: '100%',
    height: '100%',
  },
  profileTabOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
    padding: 4,
  },
  activeProfileTabOverlay: {
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  profileTabName: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    color: Colors.onPrimary,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  activeProfileTabName: {
    color: Colors.tertiary,
  },
  sectionHeader: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[6],
    paddingBottom: Spacing[2],
  },
  sectionTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.onSurface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
    paddingBottom: Spacing[1],
  },
  newMatchesContainer: {
    paddingVertical: Spacing[3],
  },
  newMatchesContent: {
    paddingHorizontal: Spacing[6],
    gap: Spacing[4],
  },
  newMatchItem: {
    width: 56, // height 100 * 9/16 ≈ 56
    alignItems: 'center',
  },
  newMatchImage: {
    width: '100%',
    height: 100,
    aspectRatio: 9 / 16,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  newMatchName: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    marginTop: 4,
  },
  inboxContainer: {
    paddingHorizontal: Spacing[6],
    gap: Spacing[4],
    marginTop: Spacing[2],
  },
  inboxItem: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    ...Shadow.waxSeal,
  },
  inboxContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inboxBanner: {
    width: 32,
    height: 56,
    backgroundColor: Colors.surfaceContainerLowest,
  },
  inboxTextContainer: {
    flex: 1,
    paddingLeft: Spacing[4],
    paddingRight: Spacing[4],
    justifyContent: 'center',
  },
  inboxName: {
    fontFamily: Fonts.heroic,
    fontSize: 16,
    color: Colors.primary,
  },
  inboxLastMessage: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    marginTop: 2,
  },
});
