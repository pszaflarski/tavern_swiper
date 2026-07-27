import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, FlatList, StyleSheet, Modal, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../../theme';
import { useProfileContext } from '../../context/ProfileContext';
import { useProfiles, Profile } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useInvolvedMatches, useCreateConversation, UnifiedMatch, UnifiedConversation } from '../../hooks/useMessages';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import DiceLoadingScreen from '../../components/DiceLoadingScreen';
import { styles } from './styles';
import { useUnreadStatus } from '../../hooks/useUnreadStatus';
import { getMessagePreview } from '../../lib/messageParser';

type NewMatchesListItem = UnifiedMatch | { id: string; isAddButton: boolean };

// ─── Module-level memoized components ────────────────────────────────

const AvatarFallback = React.memo(({ size, style }: { size: number; style?: any }) => (
  <View style={[{ width: size, height: size, backgroundColor: Colors.surfaceContainerHigh, justifyContent: 'center', alignItems: 'center' }, style]}>
    <Ionicons name="person" size={size * 0.5} color={Colors.outline} />
  </View>
));
AvatarFallback.displayName = 'AvatarFallback';

// Stable style reference for pressed state (avoids creating new objects per render)
const pressedOpacity07 = { opacity: 0.7 };
const pressedOpacity08 = { opacity: 0.8 };

// ─── ProfileTab ──────────────────────────────────────────────────────

interface ProfileTabProps {
  profile: Profile;
  isActive: boolean;
  hasUnread: boolean;
  onPress: (profileId: string) => void;
}

const ProfileTab = React.memo(({ profile, isActive, hasUnread, onPress }: ProfileTabProps) => {
  const handlePress = useCallback(() => onPress(profile.profile_id), [onPress, profile.profile_id]);

  return (
    <Pressable
      testID={`profile-tab-${profile.profile_id}`}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.profileTab,
        isActive && styles.activeProfileTab,
        pressed && pressedOpacity08,
      ]}
    >
      {profile.image_urls?.[0] ? (
        <Image source={{ uri: profile.image_urls[0] }} style={styles.profileTabImage} />
      ) : (
        <AvatarFallback size={100} style={styles.profileTabImage} />
      )}
      <View style={[styles.profileTabOverlay, isActive && styles.activeProfileTabOverlay]}>
        <Text
          style={[styles.profileTabName, isActive && styles.activeProfileTabName]}
          numberOfLines={1}
        >
          {profile.display_name}
        </Text>
      </View>
      {hasUnread && <View style={styles.profileUnreadDot} />}
    </Pressable>
  );
});
ProfileTab.displayName = 'ProfileTab';

// ─── NewMatchItem ────────────────────────────────────────────────────

interface NewMatchItemProps {
  match: UnifiedMatch;
  onPress: (profileId: string) => void;
}

const NewMatchItem = React.memo(({ match, onPress }: NewMatchItemProps) => {
  const handlePress = useCallback(() => {
    if (match.otherProfile?.profile_id) {
      onPress(match.otherProfile.profile_id);
    }
  }, [onPress, match.otherProfile?.profile_id]);

  return (
    <Pressable
      testID={`new-match-${match.id}`}
      style={({ pressed }) => [styles.newMatchItem, pressed && pressedOpacity07]}
      onPress={handlePress}
    >
      {match.otherProfile?.image_urls?.[0] ? (
        <Image source={{ uri: match.otherProfile.image_urls[0] }} style={styles.newMatchImage} />
      ) : (
        <AvatarFallback size={100} style={styles.newMatchImage} />
      )}
      <Text style={styles.newMatchName} numberOfLines={1}>
        {match.otherProfile?.display_name || 'Mysterious Soul'}
      </Text>
    </Pressable>
  );
});
NewMatchItem.displayName = 'NewMatchItem';

// ─── ConversationRow ─────────────────────────────────────────────────

interface ConversationRowProps {
  convo: UnifiedConversation;
  onPress: (convoId: string) => void;
}

const ConversationRow = React.memo(({ convo, onPress }: ConversationRowProps) => {
  const handlePress = useCallback(() => onPress(convo.id), [onPress, convo.id]);

  // Memoize the message preview so JSON.parse only runs when content changes
  const preview = useMemo(
    () => (convo.last_message?.content ? getMessagePreview(convo.last_message.content) : ''),
    [convo.last_message?.content],
  );

  return (
    <Pressable
      testID={`inbox-item-${convo.id}`}
      style={({ pressed }) => [styles.inboxItem, inboxItemStyle, pressed && pressedOpacity07]}
      onPress={handlePress}
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
            {preview}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});
ConversationRow.displayName = 'ConversationRow';

// ─── Item layout constants for FlatList ──────────────────────────────
// inboxItem: padding=Spacing[2](8)*2 + banner(56) + border(1)*2 = 74
// inboxContainer gap=Spacing[4](16) acts as separator
const ITEM_HEIGHT = 74;
const SEPARATOR_HEIGHT = Spacing[4]; // 16

// Profile Tab: height 100 * 9/16 = 56.25 width. Gap = 16.
const PROFILE_TAB_WIDTH = 56.25;
const PROFILE_TAB_GAP = Spacing[4]; // 16

// New Match Item: width 56. Gap = 16.
const NEW_MATCH_WIDTH = 56;
const NEW_MATCH_GAP = Spacing[4]; // 16

const ItemSeparator = React.memo(() => <View style={separatorStyles.verticalSeparator} />);
ItemSeparator.displayName = 'ItemSeparator';

const HorizontalSeparator = React.memo(() => <View style={separatorStyles.horizontalSeparator} />);
HorizontalSeparator.displayName = 'HorizontalSeparator';

const ProfileTabsEmpty = React.memo(() => (
  <Text style={styles.emptyText}>No identities forged yet.</Text>
));
ProfileTabsEmpty.displayName = 'ProfileTabsEmpty';

const NewMatchesEmpty = React.memo(() => (
  <Text style={styles.emptyText}>The stars reflect no new paths today.</Text>
));
NewMatchesEmpty.displayName = 'NewMatchesEmpty';

const separatorStyles = StyleSheet.create({
  verticalSeparator: { height: SEPARATOR_HEIGHT, marginHorizontal: Spacing[6] },
  horizontalSeparator: { width: Spacing[4] },
});

// ─── Main Screen ─────────────────────────────────────────────────────

function MessagesScreenInner() {
  const router = useRouter();
  const { uid } = useUser();
  const { activeProfileId, setActiveProfileId } = useProfileContext();
  const { data: myProfiles = [], isLoading: isLoadingMyProfiles, refetch: refetchProfiles } = useProfiles(uid);
  const { newMatches, inbox, isLoading: isLoadingContent, refetch: refetchMatches } = useInvolvedMatches(activeProfileId);

  const { unreadByProfile } = useUnreadStatus();

  useRefreshOnFocus(React.useCallback(() => {
    refetchProfiles();
    refetchMatches();
  }, [refetchProfiles, refetchMatches]));

  const availableCompanions = useMemo(() => {
    const map = new Map<string, Profile>();
    (newMatches || []).forEach(m => {
      if (m.otherProfile?.profile_id) {
        map.set(m.otherProfile.profile_id, m.otherProfile);
      }
    });
    (inbox || []).forEach(c => {
      if (c.otherProfile?.profile_id) {
        map.set(c.otherProfile.profile_id, c.otherProfile);
      }
      if (c.participantProfiles) {
        c.participantProfiles.forEach(p => {
          if (p.profile_id && p.profile_id !== activeProfileId) {
            map.set(p.profile_id, p);
          }
        });
      }
    });
    return Array.from(map.values());
  }, [newMatches, inbox, activeProfileId]);

  const toggleCompanion = useCallback((pid: string) => {
    setSelectedCompanionIds(prev =>
      prev.includes(pid) ? prev.filter(id => id !== pid) : [...prev, pid]
    );
  }, []);

  const sortedProfilesForTabs = useMemo(() => {
    if (!Array.isArray(myProfiles)) return [];
    return [...myProfiles].sort((a, b) => {
      const aHasUnread = !!unreadByProfile[a.profile_id];
      const bHasUnread = !!unreadByProfile[b.profile_id];
      if (aHasUnread && !bHasUnread) return -1;
      if (!aHasUnread && bHasUnread) return 1;
      return 0;
    });
  }, [myProfiles, unreadByProfile]);

  const handleMatchPress = useCallback((otherProfileId: string) => {
    if (!activeProfileId) return;
    router.push(`/messages/new_${otherProfileId}`);
  }, [activeProfileId, router]);

  const handleConversationPress = useCallback((convoId: string) => {
    router.push(`/messages/${convoId}`);
  }, [router]);

  const handleNewConversationPress = useCallback(() => {
    setGroupName('');
    setSelectedCompanionIds([]);
    setIsModalOpen(true);
  }, []);

  const handleFormParty = useCallback(async () => {
    if (!activeProfileId || selectedCompanionIds.length === 0) return;
    try {
      const res = await createConversation.mutateAsync({
        participants: [activeProfileId, ...selectedCompanionIds],
        type: 'group',
        name: groupName.trim() || 'Guild Party',
      });
      setIsModalOpen(false);
      router.push(`/messages/${res.conversation_id}`);
    } catch (err: any) {
      Toast.show({
        type: 'error',
        text1: 'Failed to Gather Party',
        text2: err?.response?.data?.detail || err.message || 'Could not form group chat.',
      });
    }
  }, [activeProfileId, selectedCompanionIds, groupName, createConversation, router]);

  const newMatchesData = useMemo(() => {
    return [{ id: 'add-convo-btn', isAddButton: true }, ...(newMatches || [])];
  }, [newMatches]);

  const keyExtractor = useCallback((item: UnifiedConversation) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: UnifiedConversation }) => (
      <ConversationRow convo={item} onPress={handleConversationPress} />
    ),
    [handleConversationPress],
  );

  const getItemLayout = useCallback(
    (_data: any, index: number) => ({
      length: ITEM_HEIGHT,
      offset: (ITEM_HEIGHT + SEPARATOR_HEIGHT) * index,
      index,
    }),
    [],
  );

  const keyExtractorProfileTab = useCallback((item: Profile) => item.profile_id, []);

  const renderProfileTabItem = useCallback(
    ({ item }: { item: Profile }) => (
      <ProfileTab
        profile={item}
        isActive={activeProfileId === item.profile_id}
        hasUnread={!!unreadByProfile[item.profile_id]}
        onPress={setActiveProfileId}
      />
    ),
    [activeProfileId, unreadByProfile, setActiveProfileId],
  );

  const getItemLayoutProfileTab = useCallback(
    (_data: any, index: number) => ({
      length: PROFILE_TAB_WIDTH,
      offset: (PROFILE_TAB_WIDTH + PROFILE_TAB_GAP) * index,
      index,
    }),
    [],
  );

  const keyExtractorNewMatch = useCallback((item: NewMatchesListItem) => item.id, []);

  const renderNewMatchItem = useCallback(
    ({ item }: { item: NewMatchesListItem }) => {
      if ('isAddButton' in item && item.isAddButton) {
        return (
          <Pressable
            testID="new-conversation-button"
            style={({ pressed }) => [styles.newMatchItem, pressed && pressedOpacity07]}
            onPress={handleNewConversationPress}
          >
            <View style={styles.newMatchAddButton}>
              <Ionicons name="add" size={24} color={Colors.primary} />
            </View>
            <Text style={styles.newMatchName} numberOfLines={1}>
              Gather Party
            </Text>
          </Pressable>
        );
      }
      return <NewMatchItem match={item as UnifiedMatch} onPress={handleMatchPress} />;
    },
    [handleMatchPress, handleNewConversationPress],
  );

  const getItemLayoutNewMatch = useCallback(
    (_data: any, index: number) => ({
      length: NEW_MATCH_WIDTH,
      offset: (NEW_MATCH_WIDTH + NEW_MATCH_GAP) * index,
      index,
    }),
    [],
  );

  const ListHeader = useMemo(() => (
    <>
      <View style={styles.profileTabsContainer}>
        {isLoadingMyProfiles ? (
          <ActivityIndicator color={Colors.primary} style={loadingIndicatorStyle} />
        ) : (
          <FlatList
            horizontal
            data={sortedProfilesForTabs}
            renderItem={renderProfileTabItem}
            keyExtractor={keyExtractorProfileTab}
            getItemLayout={getItemLayoutProfileTab}
            ItemSeparatorComponent={HorizontalSeparator}
            contentContainerStyle={horizontalListContentStyle}
            showsHorizontalScrollIndicator={false}
            ListEmptyComponent={ProfileTabsEmpty}
          />
        )}
      </View>

      {isLoadingContent ? (
        <DiceLoadingScreen message="Consulting the Oracle..." />
      ) : (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>New Matches</Text>
          </View>
          <View style={styles.newMatchesContainer}>
            <FlatList
              horizontal
              data={newMatchesData}
              renderItem={renderNewMatchItem}
              keyExtractor={keyExtractorNewMatch}
              getItemLayout={getItemLayoutNewMatch}
              ItemSeparatorComponent={HorizontalSeparator}
              contentContainerStyle={horizontalListContentStyle}
              showsHorizontalScrollIndicator={false}
              ListEmptyComponent={NewMatchesEmpty}
            />
          </View>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Inbox</Text>
          </View>
        </>
      )}
    </>
  ), [
    isLoadingMyProfiles, sortedProfilesForTabs, isLoadingContent, newMatchesData, 
    renderProfileTabItem, keyExtractorProfileTab, getItemLayoutProfileTab, 
    renderNewMatchItem, keyExtractorNewMatch, getItemLayoutNewMatch
  ]);

  const ListEmpty = useMemo(() => (
    isLoadingContent ? null : (
      <View style={emptyInboxStyle}>
        <Text style={styles.emptyText}>Silence reigns in the tavern.</Text>
      </View>
    )
  ), [isLoadingContent]);

  const ListFooter = useMemo(() => <View style={footerStyle} />, []);

  const inboxData = useMemo(() => {
    if (isLoadingContent || !inbox) return [];
    return [...inbox].sort((a, b) => {
      if (a.unread && !b.unread) return -1;
      if (!a.unread && b.unread) return 1;
      const aTime = a.last_message?.sent_at || a.updated_at || a.created_at || '';
      const bTime = b.last_message?.sent_at || b.updated_at || b.created_at || '';
      return bTime.localeCompare(aTime);
    });
  }, [isLoadingContent, inbox]);

  return (
    <View style={styles.container} testID="messages-screen">
      <ScreenHeader title="Messages" />

      <FlatList
        data={inboxData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemLayout={getItemLayout}
        ItemSeparatorComponent={ItemSeparator}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        style={flatListStyle}
        contentContainerStyle={inboxListContentStyle}
        showsVerticalScrollIndicator={false}
        windowSize={7}
        maxToRenderPerBatch={8}
        initialNumToRender={10}
        removeClippedSubviews={true}
      />

      <Modal
        visible={isModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="gather-party-modal">
            <Text style={styles.modalTitle}>Gather Your Party</Text>
            <Text style={styles.modalSubtitle}>Form a fellowship of matched companions</Text>

            <TextInput
              style={styles.groupInput}
              placeholder="Party Name (e.g. Fellowship of Tavern)"
              placeholderTextColor={Colors.outline}
              value={groupName}
              onChangeText={setGroupName}
              testID="group-name-input"
            />

            <Text style={styles.companionListTitle}>Select Companions</Text>
            {availableCompanions.length === 0 ? (
              <Text style={styles.emptyText}>No matched companions available yet.</Text>
            ) : (
              <ScrollView style={styles.companionScroll} nestedScrollEnabled>
                {availableCompanions.map(comp => {
                  const isSelected = selectedCompanionIds.includes(comp.profile_id);
                  return (
                    <Pressable
                      key={comp.profile_id}
                      style={[styles.companionItem, isSelected && styles.companionItemActive]}
                      onPress={() => toggleCompanion(comp.profile_id)}
                      testID={`companion-item-${comp.profile_id}`}
                    >
                      {comp.image_urls?.[0] ? (
                        <Image source={{ uri: comp.image_urls[0] }} style={styles.companionAvatar} />
                      ) : (
                        <AvatarFallback size={36} style={styles.companionAvatar} />
                      )}
                      <Text style={styles.companionName}>{comp.display_name}</Text>
                      <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                        {isSelected && <Ionicons name="checkmark" size={14} color={Colors.onTertiary} />}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelButton}
                onPress={() => setIsModalOpen(false)}
                testID="cancel-party-button"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.createButton,
                  (selectedCompanionIds.length === 0 || createConversation.isPending) && styles.createButtonDisabled,
                ]}
                disabled={selectedCompanionIds.length === 0 || createConversation.isPending}
                onPress={handleFormParty}
                testID="form-party-button"
              >
                {createConversation.isPending ? (
                  <ActivityIndicator size="small" color={Colors.onTertiary} />
                ) : (
                  <Text style={styles.createButtonText}>Form Party</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const loadingIndicatorStyle = { marginVertical: Spacing[4] };
const emptyInboxStyle = { paddingVertical: Spacing[10], paddingHorizontal: Spacing[6], alignItems: 'center' as const };
const footerStyle = { height: Spacing[20] };
const inboxListContentStyle = { flexGrow: 1 };
const horizontalListContentStyle = { paddingHorizontal: Spacing[6] };
const flatListStyle = { flex: 1 };
const inboxItemStyle = { marginHorizontal: Spacing[6] };

export default function MessagesScreen() {
  return (
    <ScreenErrorBoundary fallbackMessage="The raven could not deliver your messages.">
      <MessagesScreenInner />
    </ScreenErrorBoundary>
  );
}
