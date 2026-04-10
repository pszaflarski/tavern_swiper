import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';
import { useProfileContext } from '../../context/ProfileContext';
import { useProfiles } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useInvolvedMatches } from '../../hooks/useMessages';
import ScreenHeader from '../../components/ScreenHeader';

const PLACEHOLDER_IMAGE = require('../../assets/images/placeholder/hero1.jpeg');

export default function MessagesScreen() {
  const { user } = useUser();
  const { activeProfileId, setActiveProfileId } = useProfileContext();
  const { data: myProfiles = [], isLoading: isLoadingMyProfiles } = useProfiles(user?.uid);
  const { newMatches, inbox, isLoading: isLoadingContent } = useInvolvedMatches(activeProfileId);

  const selectedProfile = myProfiles.find(p => p.profile_id === activeProfileId);

  const renderProfileImage = (uri: string | undefined) => {
    return uri ? { uri } : PLACEHOLDER_IMAGE;
  };

  return (
    <View style={styles.container} testID="messages-screen">
      <ScreenHeader title="Messages" />

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Tabs Section */}
        <View style={styles.profileTabsContainer}>
          {isLoadingMyProfiles ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing[4] }} />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.profileTabsContent}>
              {myProfiles.map((profile) => (
                <TouchableOpacity 
                  key={profile.profile_id} 
                  testID={`profile-tab-${profile.profile_id}`}
                  onPress={() => setActiveProfileId(profile.profile_id)}
                  style={[
                    styles.profileTab, 
                    activeProfileId === profile.profile_id && styles.activeProfileTab
                  ]}
                >
                  <Image 
                    source={renderProfileImage(profile.image_urls?.[0])} 
                    style={styles.profileTabImage} 
                  />
                  <View style={[styles.profileTabOverlay, activeProfileId === profile.profile_id && styles.activeProfileTabOverlay]}>
                    <Text 
                      style={[styles.profileTabName, activeProfileId === profile.profile_id && styles.activeProfileTabName]}
                      numberOfLines={1}
                    >
                      {profile.display_name}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              {myProfiles.length === 0 && (
                <Text style={styles.emptyText}>No identities forged yet.</Text>
              )}
            </ScrollView>
          )}
        </View>

        {isLoadingContent ? (
          <View style={{ padding: Spacing[10], alignItems: 'center' }}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={[styles.headerSub, { marginTop: Spacing[4] }]}>Consulting the Oracle...</Text>
          </View>
        ) : (
          <>
            {/* New Matches Section */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>New Visions for {selectedProfile?.display_name || '... '}</Text>
            </View>
            <View style={styles.newMatchesContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.newMatchesContent}>
                {newMatches.map((match) => (
                  <TouchableOpacity 
                    key={match.id} 
                    testID={`new-match-${match.id}`}
                    style={styles.newMatchItem}
                  >
                    <Image 
                      source={renderProfileImage(match.otherProfile?.image_urls?.[0])} 
                      style={styles.newMatchImage} 
                    />
                    <Text style={styles.newMatchName} numberOfLines={1}>{match.otherProfile?.display_name || 'Mysterious Soul'}</Text>
                  </TouchableOpacity>
                ))}
                {newMatches.length === 0 && (
                  <Text style={styles.emptyText}>The stars reflect no new paths today.</Text>
                )}
              </ScrollView>
            </View>

            {/* Inbox Section */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Inbox</Text>
            </View>
            <View style={styles.inboxContainer}>
              {inbox.map((convo) => (
                <TouchableOpacity 
                  key={convo.id} 
                  testID={`inbox-item-${convo.id}`}
                  style={styles.inboxItem}
                >
                  <View style={styles.inboxContent}>
                    <Image 
                      source={renderProfileImage(convo.otherProfile?.image_urls?.[0])} 
                      style={styles.inboxBanner} 
                      resizeMode="cover" 
                    />
                    <View style={styles.inboxTextContainer}>
                      <Text style={styles.inboxName}>{convo.otherProfile?.display_name || 'Traveler'}</Text>
                      <Text style={styles.inboxLastMessage} numberOfLines={1}>
                        {convo.lastMessage?.content}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              {inbox.length === 0 && (
                <View style={{ paddingVertical: Spacing[10], alignItems: 'center' }}>
                  <Text style={styles.emptyText}>Silence reigns in the tavern.</Text>
                </View>
              )}
            </View>
          </>
        )}
        
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
  emptyText: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    textAlign: 'center',
    marginTop: Spacing[4],
    fontStyle: 'italic',
  },
});
