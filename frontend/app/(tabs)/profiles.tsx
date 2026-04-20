import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';
import { useProfiles, Profile, useDeleteProfile } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useProfileContext } from '../../context/ProfileContext';
import { useRefreshOnFocus } from '../../hooks/useRefreshOnFocus';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from 'react-native';
import ScreenHeader from '../../components/ScreenHeader';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';

function ProfilesScreenInner() {
  const { uid, isLoading: isLoadingUser } = useUser();
  const { data: profiles, isPending: isPendingProfiles, refetch } = useProfiles(uid);
  const { activeProfileId, setActiveProfileId } = useProfileContext();
  const deleteProfileMutation = useDeleteProfile();

  useRefreshOnFocus(refetch);
  const router = useRouter();

  const isActuallyLoading = isLoadingUser && !profiles;

  const handleEdit = (profileId: string) => {
    router.push({
      pathname: '/profiles/create_and_edit',
      params: { id: profileId }
    } as any);
  };

  const handleCreate = () => {
    router.push('/profiles/create_and_edit');
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
      <View style={styles.cardContainer}>
        <TouchableOpacity
          style={[
            styles.profileCard,
            isActive && styles.activeProfileCard
          ]}
          onPress={() => setActiveProfileId(item.profile_id)}
          testID={`profile-item-${item.profile_id}`}
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
                <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
              </View>
            )}
          </View>

          <View style={styles.profileInfo}>
            <Text style={styles.profileName} testID={`profile-name-${item.display_name}`}>{item.display_name}</Text>
            {item.bio && (
              <Text style={styles.profileTagline} numberOfLines={2}>{item.bio}</Text>
            )}
          </View>

          <View style={styles.cardActions}>
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={() => handleEdit(item.profile_id)}
              testID={`edit-profile-${item.profile_id}`}
              accessibilityLabel={`Edit ${item.display_name} profile`}
              accessibilityRole="button"
            >
              <Ionicons name="pencil" size={20} color={Colors.outline} />
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={() => handleDelete(item.profile_id, item.display_name)}
              testID={`delete-profile-${item.profile_id}`}
              accessibilityLabel={`Delete ${item.display_name} profile`}
              accessibilityRole="button"
            >
              <Ionicons name="trash-outline" size={20} color={Colors.error} />
            </TouchableOpacity>

            <View style={styles.selectionIndicator}>
              <Ionicons 
                name={isActive ? 'radio-button-on' : 'radio-button-off'} 
                size={22} 
                color={isActive ? Colors.primary : Colors.outlineVariant} 
              />
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderFooter = () => (
    <TouchableOpacity 
      style={styles.addProfileButton} 
      onPress={handleCreate}
      testID="add-profile-button"
      accessibilityLabel="Forge new identity"
      accessibilityRole="button"
    >
      <View style={styles.addIconContainer}>
        <Ionicons name="add" size={32} color={Colors.primary} />
      </View>
      <Text style={styles.addProfileText}>Forge New Identity</Text>
    </TouchableOpacity>
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
          <Text style={styles.emptyIcon}>📜</Text>
          <Text style={styles.emptyText}>No heroes have been forged yet.</Text>
          <TouchableOpacity 
            style={[styles.addProfileButton, { marginTop: Spacing[6], width: 'auto', paddingHorizontal: Spacing[8] }]} 
            onPress={handleCreate}
            testID="empty-state-add-profile-button"
          >
            <Ionicons name="flash" size={20} color={Colors.primary} style={{ marginRight: 8 }} />
            <Text style={styles.addProfileText}>Forge Your First Hero</Text>
          </TouchableOpacity>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  loadingText: {
    marginTop: Spacing[4],
    fontFamily: Fonts.scribe,
    color: Colors.outline,
    letterSpacing: 1,
  },
  listContent: {
    padding: Spacing[4],
    gap: Spacing[4],
  },
  cardContainer: {
    marginBottom: Spacing[2],
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing[4],
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    ...Shadow.waxSeal,
  },
  activeProfileCard: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceContainerHigh,
  },
  profileImageContainer: {
    position: 'relative',
    marginRight: Spacing[4],
  },
  profileImage: {
    height: 80,
    aspectRatio: 9 / 16,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceVariant,
  },
  profileImagePlaceholder: {
    height: 80,
    aspectRatio: 9 / 16,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceVariant,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderEmoji: {
    fontSize: 20,
  },
  activeBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    zIndex: 1,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.onSurface,
    marginBottom: 2,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
  },
  actionButton: {
    padding: Spacing[2],
  },
  selectionIndicator: {
    marginLeft: Spacing[1],
  },
  profileClass: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  profileTagline: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    marginTop: 4,
    fontStyle: 'italic',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: Spacing[4],
  },
  emptyText: {
    fontFamily: Fonts.scribe,
    fontSize: 16,
    color: Colors.outline,
  },
  addProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[4],
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderStyle: 'dashed',
    marginTop: Spacing[2],
    marginBottom: Spacing[10],
  },
  addIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surfaceContainerLow,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing[4],
  },
  addProfileText: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.primary,
  }
});
