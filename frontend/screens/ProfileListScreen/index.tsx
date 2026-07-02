import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { View, Text, FlatList, Pressable, Image, Platform, Animated } from 'react-native';
import { Stack, useRouter, Link } from 'expo-router';
import Toast from 'react-native-toast-message';
import { Colors, Fonts, Spacing } from '../../theme';
import { useProfiles, Profile, useDeleteProfile, useShareProfile, useUnshareProfile } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useProfileContext } from '../../context/ProfileContext';
import { useMatch } from '../../context/MatchContext';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from 'react-native';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import DiceLoadingScreen from '../../components/DiceLoadingScreen';
import { styles } from './styles';

/** Individual profile card with hamburger-expand pattern */
function ProfileCard({
  item,
  isActive,
  onSetActive,
  onPreview,
  onEdit,
  onDelete,
  onShare,
  onUnshare,
}: {
  item: Profile;
  isActive: boolean;
  onSetActive: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onShare: () => void;
  onUnshare: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: expanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [expanded]);

  const handleAction = useCallback((action: () => void) => {
    setExpanded(false);
    action();
  }, []);

  return (
    <View style={styles.cardContainer}>
      <View
        style={[
          styles.profileCard,
          isActive ? styles.activeProfileCard : styles.inactiveProfileCard,
        ]}
        testID={`profile-item-${item.profile_id}`}
      >
        {/* Normal card content */}
        {!expanded && (
          <Pressable
            style={styles.cardNormalContent}
            onPress={() => { if (!isActive) onSetActive(); }}
            testID={`profile-card-tap-${item.profile_id}`}
            accessibilityLabel={isActive ? `${item.display_name} is active` : `Tap to activate ${item.display_name}`}
            accessibilityRole="button"
          >
            <View style={styles.profileImageContainer}>
              {item.image_urls?.[0] ? (
                <Image source={{ uri: item.image_urls[0] }} style={styles.profileImage} />
              ) : (
                <View style={styles.profileImagePlaceholder}>
                  <Text style={styles.placeholderEmoji}>🎭</Text>
                </View>
              )}
              {isActive && (
                <View style={styles.activeBadge}>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.tertiary} />
                </View>
              )}
            </View>

            <View style={styles.profileInfo}>
              <Text style={[styles.profileName, isActive && styles.activeProfileName]} testID={`profile-name-${item.display_name}`}>
                {item.display_name}
              </Text>
              {item.bio && (
                <Text style={styles.profileTagline} numberOfLines={2}>{item.bio}</Text>
              )}
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.hamburgerButton,
                pressed && { opacity: 0.6 },
              ]}
              onPress={() => setExpanded(true)}
              testID={`profile-menu-${item.profile_id}`}
              accessibilityLabel={`Open actions for ${item.display_name}`}
              accessibilityRole="button"
            >
              <Ionicons name="ellipsis-vertical" size={22} color={Colors.outline} />
            </Pressable>
          </Pressable>
        )}

        {/* Expanded action overlay */}
        {expanded && (
          <Animated.View style={[styles.expandedActions, { opacity: fadeAnim }]}>
            {!isActive && (
              <Pressable
                style={({ pressed }) => [
                  styles.expandedButton,
                  styles.expandedButtonSelect,
                  pressed && styles.expandedButtonPressed,
                ]}
                onPress={() => handleAction(onSetActive)}
                testID={`select-profile-button-${item.profile_id}`}
                accessibilityLabel={`Set ${item.display_name} as active`}
                accessibilityRole="button"
              >
                <Ionicons name="shield-checkmark" size={20} color={Colors.tertiary} />
                <Text style={[styles.expandedButtonText, styles.expandedButtonTextSelect]}>Set Active</Text>
              </Pressable>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.expandedButton,
                pressed && styles.expandedButtonPressed,
              ]}
              onPress={() => handleAction(onPreview)}
              testID={`preview-profile-button-${item.profile_id}`}
              accessibilityLabel={`Preview ${item.display_name} profile`}
              accessibilityRole="button"
            >
              <Ionicons name="eye" size={20} color={Colors.primaryFixed} />
              <Text style={styles.expandedButtonText}>Preview</Text>
            </Pressable>

            {item.shared_at ? (
              <Pressable
                style={({ pressed }) => [
                  styles.expandedButton,
                  pressed && styles.expandedButtonPressed,
                ]}
                onPress={() => handleAction(onUnshare)}
                testID={`unshare-profile-button-${item.profile_id}`}
                accessibilityLabel={`Stop sharing ${item.display_name}`}
                accessibilityRole="button"
              >
                <Ionicons name="close-circle-outline" size={20} color={Colors.error} />
                <Text style={styles.expandedButtonText}>Cancel Share</Text>
              </Pressable>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.expandedButton,
                  pressed && styles.expandedButtonPressed,
                ]}
                onPress={() => handleAction(onShare)}
                testID={`share-profile-button-${item.profile_id}`}
                accessibilityLabel={`Share ${item.display_name}`}
                accessibilityRole="button"
              >
                <Ionicons name="share-social-outline" size={20} color={Colors.primaryFixed} />
                <Text style={styles.expandedButtonText}>Share Profile</Text>
              </Pressable>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.expandedButton,
                item.generated && styles.expandedButtonDisabled,
                pressed && !item.generated && styles.expandedButtonPressed,
              ]}
              onPress={() => {
                if (!item.generated) {
                  handleAction(onEdit);
                }
              }}
              disabled={item.generated}
              testID={`edit-profile-button-${item.profile_id}`}
              accessibilityLabel={`Edit ${item.display_name} profile`}
              accessibilityRole="button"
            >
              <Ionicons
                name="pencil"
                size={20}
                color={item.generated ? Colors.outline : Colors.primaryFixed}
              />
              <Text style={[
                styles.expandedButtonText,
                item.generated && styles.expandedButtonTextDisabled,
              ]}>
                Edit
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.expandedButton,
                styles.expandedButtonDanger,
                pressed && styles.expandedButtonPressed,
              ]}
              onPress={() => handleAction(onDelete)}
              testID={`delete-profile-button-${item.profile_id}`}
              accessibilityLabel={`Delete ${item.display_name} profile`}
              accessibilityRole="button"
            >
              <Ionicons name="trash-outline" size={20} color={Colors.error} />
              <Text style={[styles.expandedButtonText, styles.expandedButtonTextDanger]}>Delete</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.expandedButton,
                styles.expandedButtonCancel,
                pressed && styles.expandedButtonPressed,
              ]}
              onPress={() => setExpanded(false)}
              testID={`cancel-menu-button-${item.profile_id}`}
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={20} color={Colors.outline} />
              <Text style={[styles.expandedButtonText, styles.expandedButtonTextCancel]}>Cancel</Text>
            </Pressable>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

function ProfilesScreenInner() {
  const { uid, isLoading: isLoadingUser } = useUser();
  const { data: profiles, isPending: isPendingProfiles, refetch } = useProfiles(uid);
  const { activeProfileId, setActiveProfileId } = useProfileContext();
  const { showMatch } = useMatch();
  const deleteProfileMutation = useDeleteProfile();
  const shareMutation = useShareProfile();
  const unshareMutation = useUnshareProfile();

  const sortedProfiles = useMemo(() => {
    if (!Array.isArray(profiles)) return [];
    return [...profiles].sort((a, b) => {
      if (a.profile_id === activeProfileId) return -1;
      if (b.profile_id === activeProfileId) return 1;
      return 0;
    });
  }, [profiles, activeProfileId]);

  useRefreshOnFocus(refetch);
  const router = useRouter();

  const isActuallyLoading = isLoadingUser && !profiles;

  const handleEdit = (profileId: string) => {
    router.push({
      pathname: '/profiles/form',
      params: { id: profileId }
    } as any);
  };

  const handleCreate = () => {
    router.push('/profiles/form' as any);
  };

  const handleDelete = (profileId: string, displayName: string) => {
    const title = 'Cast Into The Void';
    const message = `Are you certain you wish to erase the legend of ${displayName} forever?`;

    if (Platform.OS === 'web') {
      const confirmed = window.confirm(`${title}\n\n${message}`);
      if (confirmed) {
        deleteProfileMutation.mutate(profileId);
      }
    } else {
      Alert.alert(
        title,
        message,
        [
          { text: 'Spare Them', style: 'cancel' },
          { 
            text: 'Erase', 
            style: 'destructive',
            onPress: () => deleteProfileMutation.mutate(profileId)
          },
        ]
      );
    }
  };

  const handleShare = (profileId: string) => {
    shareMutation.mutate(profileId, {
      onSuccess: () => {
        const origin = Platform.OS === 'web' && typeof window !== 'undefined'
          ? window.location.origin
          : 'http://localhost:8081';
        const shareUrl = `${origin}/shared_profiles/${profileId}`;
        
        const Clipboard = require('expo-clipboard');
        Clipboard.setStringAsync(shareUrl).then(() => {
          Toast.show({
            type: 'success',
            text1: 'Sharing Spell Active!',
            text2: 'Share link copied to clipboard.',
          });
        }).catch((err: any) => {
          console.error('Clipboard copy failed:', err);
          Alert.alert('Sharing Spell Active!', `Share link: ${shareUrl}`);
        });
      },
    });
  };

  const handleUnshare = (profileId: string) => {
    unshareMutation.mutate(profileId, {
      onSuccess: () => {
        Toast.show({
          type: 'success',
          text1: 'Sharing Deactivated',
          text2: 'The legend is no longer accessible via link.',
        });
      },
    });
  };

  const renderProfileItem = ({ item }: { item: Profile }) => {
    const isActive = activeProfileId === item.profile_id;
    return (
      <ProfileCard 
        item={item}
        isActive={isActive}
        onSetActive={() => setActiveProfileId(item.profile_id)}
        onPreview={() => router.push({ pathname: '/profiles/preview', params: { id: item.profile_id } } as any)}
        onEdit={() => handleEdit(item.profile_id)}
        onDelete={() => handleDelete(item.profile_id, item.display_name)}
        onShare={() => handleShare(item.profile_id)}
        onUnshare={() => handleUnshare(item.profile_id)}
      />
    );
  };

  const renderFooter = () => {
    return (
      <View>
        <Pressable
          style={({ pressed }) => [
            styles.wizardButton,
            pressed && { opacity: 0.7 }
          ]}
          onPress={() => router.push('/character-wizard' as any)}
          testID="wizard-button"
        >
          <Ionicons name="sparkles" size={18} color={Colors.tertiary} />
          <Text style={styles.wizardButtonText}>Use Character Wizard</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.outline} />
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.addProfileButton,
            pressed && { opacity: 0.7 }
          ]}
          onPress={handleCreate}
          testID="add-profile-button"
        >
          <Ionicons name="add" size={18} color={Colors.tertiary} />
          <Text style={styles.wizardButtonText}>Custom Character</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.outline} />
        </Pressable>
      </View>
    );
  };

  if (isActuallyLoading) {
    return <DiceLoadingScreen message="Consulting the Archives..." />;
  }

  return (
    <View style={styles.container} testID="profiles-screen">
      <Stack.Screen 
        options={{ 
          headerShown: false,
        }} 
      />
      
      <ScreenHeader title="Profiles" />
      
      {profiles === undefined ? (
        <DiceLoadingScreen message="Awakening the Archive..." />
      ) : profiles.length > 0 ? (
        <FlatList
          data={sortedProfiles}
          renderItem={renderProfileItem}
          keyExtractor={(item) => item.profile_id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={renderFooter}
        />
      ) : (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>🛡️</Text>
          <Text style={styles.emptyTitle}>Forge Your First Identity</Text>
          <Text style={styles.emptyDesc}>You must forge an identity before your legend can begin.</Text>
          <Pressable 
            style={({ pressed }) => [
              styles.emptyCtaButton,
              pressed && { opacity: 0.7 }
            ]} 
            onPress={handleCreate}
            testID="empty-state-add-profile-button"
          >
            <Text style={styles.emptyCtaText}>FORGE NEW IDENTITY</Text>
          </Pressable>
          <Text style={[styles.emptyDesc, { marginTop: 16, marginBottom: 8 }]}>— or —</Text>
          <Pressable
            style={({ pressed }) => [
              styles.wizardButton,
              { marginHorizontal: 16 },
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => router.push('/character-wizard' as any)}
            testID="empty-state-wizard-button"
          >
            <Ionicons name="sparkles" size={18} color={Colors.tertiary} />
            <Text style={styles.wizardButtonText}>Use Character Wizard</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.outline} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

export default function ProfilesScreen() {
  return (
    <ScreenErrorBoundary fallbackMessage="The archives of legends are currently inaccessible.">
      <ProfilesScreenInner />
    </ScreenErrorBoundary>
  );
}
