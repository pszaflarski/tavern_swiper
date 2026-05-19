import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, FlatList, Pressable, Image, ActivityIndicator, Platform, Animated } from 'react-native';
import { Stack, useRouter, Link } from 'expo-router';
import { Colors, Fonts, Spacing } from '../../theme';
import { useProfiles, Profile, useDeleteProfile } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useProfileContext } from '../../context/ProfileContext';
import { useMatch } from '../../context/MatchContext';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from 'react-native';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { styles } from './styles';

/** Individual profile card with hamburger-expand pattern */
function ProfileCard({
  item,
  isActive,
  onSetActive,
  onPreview,
  onEdit,
  onDelete,
}: {
  item: Profile;
  isActive: boolean;
  onSetActive: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
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
          <View style={styles.cardNormalContent}>
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
          </View>
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

            <Pressable
              style={({ pressed }) => [
                styles.expandedButton,
                pressed && styles.expandedButtonPressed,
              ]}
              onPress={() => handleAction(onEdit)}
              testID={`edit-profile-button-${item.profile_id}`}
              accessibilityLabel={`Edit ${item.display_name} profile`}
              accessibilityRole="button"
            >
              <Ionicons name="pencil" size={20} color={Colors.primaryFixed} />
              <Text style={styles.expandedButtonText}>Edit</Text>
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
          { text: 'Spar Them', style: 'cancel' },
          { 
            text: 'Erase', 
            style: 'destructive',
            onPress: () => deleteProfileMutation.mutate(profileId)
          },
        ]
      );
    }
  };

  const renderProfileItem = ({ item }: { item: Profile }) => {
    const isActive = item.profile_id === activeProfileId;

    return (
      <ProfileCard
        item={item}
        isActive={isActive}
        onSetActive={() => setActiveProfileId(item.profile_id)}
        onPreview={() => router.push({ pathname: '/profiles/preview', params: { id: item.profile_id } } as any)}
        onEdit={() => handleEdit(item.profile_id)}
        onDelete={() => handleDelete(item.profile_id, item.display_name)}
      />
    );
  };

  const renderFooter = () => (
    <Link href="/profiles/form" asChild>
      <Pressable 
        style={({ pressed }) => [
          styles.addProfileButton,
          pressed && { opacity: 0.7 }
        ]}
        testID="add-profile-button"
        accessibilityLabel="Forge new identity"
        accessibilityRole="button"
      >
        <Ionicons name="add" size={36} color={Colors.primary} />
      </Pressable>
    </Link>
  );

  if (isActuallyLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Consulting the Archives...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="profiles-screen">
      <Stack.Screen 
        options={{ 
          headerShown: false,
        }} 
      />
      
      <ScreenHeader title="Profiles" />
      
      {/* <TouchableOpacity 
        style={styles.testerButton}
        onPress={() => showMatch({
          profile_id: 'tester',
          display_name: 'Valerius the Bold',
          image_url: 'https://storage.googleapis.com/tavern-swiper-dev-media-dev/c73bb930-a364-42b4-8254-8c886e0811b0.jpg'
        })}
      >
        <Ionicons name="sparkles" size={16} color={Colors.tertiary} />
        <Text style={styles.testerText}>TEST CELEBRATION</Text>
      </TouchableOpacity> */}

      {profiles === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Awakening the Archive...</Text>
        </View>
      ) : profiles.length > 0 ? (
        <FlatList
          data={profiles}
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
