import React, { useCallback, useMemo } from 'react';
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing } from '../../theme';
import { useProfileContext } from '../../context/ProfileContext';
import { useProfiles, Profile } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useInvolvedMatches, UnifiedMatch, UnifiedConversation } from '../../hooks/useMessages';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { useRouter } from 'expo-router';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import DiceLoadingScreen from '../../components/DiceLoadingScreen';
import { styles } from './styles';
import { useUnreadStatus } from '../../hooks/useUnreadStatus';
import { getMessagePreview } from '../../lib/messageParser';

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

  const selectedProfile = useMemo(
    () => (Array.isArray(myProfiles) ? myProfiles.find(p => p.profile_id === activeProfileId) : undefined),
    [myProfiles, activeProfileId],
  );

  const sortedProfilesForTabs = useMemo(() => {
    if (!Array.isArray(myProfiles)) return [];
    return [...myProfiles].sort((a, b) => {
      // 1. Profiles with unread messages first
      const aHasUnread = !!unreadByProfile[a.profile_id];
      const bHasUnread = !!unreadByProfile[b.profile_id];
      if (aHasUnread && !bHasUnread) return -1;
      if (!aHasUnread && bHasUnread) return 1;

      // 2. Otherwise maintain existing order
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

  // ─── Main FlatList callbacks (stable references) ──────────────────

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

  // ─── Profile Tabs FlatList callbacks ──────────────────────────────

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

  // ─── New Matches FlatList callbacks ────────────────────────────────

  const keyExtractorNewMatch = useCallback((item: UnifiedMatch) => item.id, []);

  const renderNewMatchItem = useCallback(
    ({ item }: { item: UnifiedMatch }) => (
      <NewMatchItem match={item} onPress={handleMatchPress} />
    ),
    [handleMatchPress],
  );

  const getItemLayoutNewMatch = useCallback(
    (_data: any, index: number) => ({
      length: NEW_MATCH_WIDTH,
      offset: (NEW_MATCH_WIDTH + NEW_MATCH_GAP) * index,
      index,
    }),
    [],
  );

  // ─── FlatList header (profile tabs + new matches) ────────────────

  const ListHeader = useMemo(() => (
    <>
      {/* Profile Tabs Section */}
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
            windowSize={5}
            maxToRenderPerBatch={5}
            initialNumToRender={5}
            removeClippedSubviews={true}
          />
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
            <FlatList
              horizontal
              data={newMatches || []}
              renderItem={renderNewMatchItem}
              keyExtractor={keyExtractorNewMatch}
              getItemLayout={getItemLayoutNewMatch}
              ItemSeparatorComponent={HorizontalSeparator}
              contentContainerStyle={horizontalListContentStyle}
              showsHorizontalScrollIndicator={false}
              ListEmptyComponent={NewMatchesEmpty}
              windowSize={5}
              maxToRenderPerBatch={5}
              initialNumToRender={5}
              removeClippedSubviews={true}
            />
          </View>

          {/* Inbox Section Header */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Inbox</Text>
          </View>
        </>
      )}
    </>
  ), [
    isLoadingMyProfiles,
    sortedProfilesForTabs,
    isLoadingContent,
    selectedProfile,
    newMatches,
    renderProfileTabItem,
    keyExtractorProfileTab,
    getItemLayoutProfileTab,
    renderNewMatchItem,
    keyExtractorNewMatch,
    getItemLayoutNewMatch,
  ]);

  const ListEmpty = useMemo(() => (
    isLoadingContent ? null : (
      <View style={emptyInboxStyle}>
        <Text style={styles.emptyText}>Silence reigns in the tavern.</Text>
      </View>
    )
  ), [isLoadingContent]);

  const ListFooter = useMemo(() => <View style={footerStyle} />, []);

  // ─── Render ──────────────────────────────────────────────────────

  const inboxData = useMemo(() => {
    if (isLoadingContent || !inbox) return [];
    return [...inbox].sort((a, b) => {
      // 1. Unread conversations first
      if (a.unread && !b.unread) return -1;
      if (!a.unread && b.unread) return 1;

      // 2. Last message / update / creation timestamp descending
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
        // Virtualization tuning
        windowSize={7}
        maxToRenderPerBatch={8}
        initialNumToRender={10}
        removeClippedSubviews={true}
      />
    </View>
  );
}

// ─── Stable style references (avoid inline object creation) ──────────

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
