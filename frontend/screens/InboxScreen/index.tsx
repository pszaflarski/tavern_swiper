import React from 'react';
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../../theme';
import { useProfileContext } from '../../context/ProfileContext';
import { useProfiles } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useInvolvedMatches, useCreateConversation } from '../../hooks/useMessages';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useRouter } from 'expo-router';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import DiceLoadingScreen from '../../components/DiceLoadingScreen';
import { styles } from './styles';
import { useUnreadStatus } from '../../hooks/useUnreadStatus';

function MessagesScreenInner() {
  const router = useRouter();
  const { uid } = useUser();
  const { activeProfileId, setActiveProfileId } = useProfileContext();
  const { data: myProfiles = [], isLoading: isLoadingMyProfiles, refetch: refetchProfiles } = useProfiles(uid);
  const { newMatches, inbox, isLoading: isLoadingContent, refetch: refetchMatches } = useInvolvedMatches(activeProfileId);
  const { mutate: createConversation } = useCreateConversation();
  const { unreadByProfile } = useUnreadStatus();

  useRefreshOnFocus(React.useCallback(() => {
    refetchProfiles();
    refetchMatches();
  }, [refetchProfiles, refetchMatches]));

  const selectedProfile = Array.isArray(myProfiles) ? myProfiles.find(p => p.profile_id === activeProfileId) : undefined;

  const handleMatchPress = (otherProfileId: string) => {
    if (!activeProfileId) return;
    createConversation({ 
      participants: [activeProfileId, otherProfileId] 
    }, {
      onSuccess: (data) => {
        router.push(`/messages/${data.conversation_id}`);
      }
    });
  };

  const handleConversationPress = (convoId: string) => {
    router.push(`/messages/${convoId}`);
  };

  const AvatarFallback = ({ size, style }: { size: number; style?: any }) => (
    <View style={[{ width: size, height: size, backgroundColor: Colors.surfaceContainerHigh, justifyContent: 'center', alignItems: 'center' }, style]}>
      <Ionicons name="person" size={size * 0.5} color={Colors.outline} />
    </View>
  );

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
              {(myProfiles || []).map((profile) => (
                <Pressable 
                  key={profile.profile_id} 
                  testID={`profile-tab-${profile.profile_id}`}
                  onPress={() => setActiveProfileId(profile.profile_id)}
                  style={({ pressed }) => [
                    styles.profileTab, 
                    activeProfileId === profile.profile_id && styles.activeProfileTab,
                    pressed && { opacity: 0.8 }
                  ]}
                >
                  {profile.image_urls?.[0] ? (
                    <Image source={{ uri: profile.image_urls[0] }} style={styles.profileTabImage} />
                  ) : (
                    <AvatarFallback size={100} style={styles.profileTabImage} />
                  )}
                  <View style={[styles.profileTabOverlay, activeProfileId === profile.profile_id && styles.activeProfileTabOverlay]}>
                    <Text 
                      style={[styles.profileTabName, activeProfileId === profile.profile_id && styles.activeProfileTabName]}
                      numberOfLines={1}
                    >
                      {profile.display_name}
                    </Text>
                  </View>
                  {unreadByProfile[profile.profile_id] && (
                    <View style={styles.profileUnreadDot} />
                  )}
                </Pressable>
              ))}
               {(!myProfiles || myProfiles.length === 0) && (
                <Text style={styles.emptyText}>No identities forged yet.</Text>
              )}
            </ScrollView>
          )}
        </View>

        {isLoadingContent ? (
          <DiceLoadingScreen message="Consulting the Oracle..." />
        ) : (
          <>
            {/* New Matches Section */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>New Visions for {selectedProfile?.display_name || '... '}</Text>
            </View>
            <View style={styles.newMatchesContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.newMatchesContent}>
                {(newMatches || []).map((match) => (
                  <Pressable 
                    key={match.id} 
                    testID={`new-match-${match.id}`}
                    style={({ pressed }) => [
                      styles.newMatchItem,
                      pressed && { opacity: 0.7 }
                    ]}
                    onPress={() => match.otherProfile?.profile_id && handleMatchPress(match.otherProfile.profile_id)}
                  >
                    {match.otherProfile?.image_urls?.[0] ? (
                      <Image source={{ uri: match.otherProfile.image_urls[0] }} style={styles.newMatchImage} />
                    ) : (
                      <AvatarFallback size={100} style={styles.newMatchImage} />
                    )}
                    <Text style={styles.newMatchName} numberOfLines={1}>{match.otherProfile?.display_name || 'Mysterious Soul'}</Text>
                  </Pressable>
                ))}
                {(!newMatches || newMatches.length === 0) && (
                  <Text style={styles.emptyText}>The stars reflect no new paths today.</Text>
                )}
              </ScrollView>
            </View>

            {/* Inbox Section */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Inbox</Text>
            </View>
            <View style={styles.inboxContainer}>
              {(inbox || []).map((convo) => (
                <Pressable 
                  key={convo.id} 
                  testID={`inbox-item-${convo.id}`}
                  style={({ pressed }) => [
                    styles.inboxItem,
                    pressed && { opacity: 0.7 }
                  ]}
                  onPress={() => handleConversationPress(convo.id)}
                >
                  <View style={styles.inboxContent}>
                    <View style={styles.inboxAvatarContainer}>
                      {convo.otherProfile?.image_urls?.[0] ? (
                        <Image source={{ uri: convo.otherProfile.image_urls[0] }} style={styles.inboxBanner} resizeMode="cover" />
                      ) : (
                        <AvatarFallback size={56} style={styles.inboxBanner} />
                      )}
                      {convo.unread && <View style={styles.unreadDot} />}
                    </View>
                    <View style={styles.inboxTextContainer}>
                      <Text style={styles.inboxName}>{convo.otherProfile?.display_name || 'Traveler'}</Text>
                      <Text style={styles.inboxLastMessage} numberOfLines={1}>
                        {convo.last_message?.content}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}
              {(!inbox || inbox.length === 0) && (
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

export default function MessagesScreen() {
  return (
    <ScreenErrorBoundary fallbackMessage="The raven could not deliver your messages.">
      <MessagesScreenInner />
    </ScreenErrorBoundary>
  );
}

