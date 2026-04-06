import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';
import { useProfiles, Profile } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { useProfileContext } from '../../context/ProfileContext';
import { Ionicons } from '@expo/vector-icons';

export default function ProfilesScreen() {
  const { user } = useUser();
  const { data: profiles, isLoading } = useProfiles(user?.uid);
  const { activeProfileId, setActiveProfileId } = useProfileContext();
  const router = useRouter();

  const renderProfileItem = ({ item }: { item: Profile }) => {
    const isActive = item.profile_id === activeProfileId;

    return (
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

        <Ionicons 
          name={isActive ? 'radio-button-on' : 'radio-button-off'} 
          size={24} 
          color={isActive ? Colors.primary : Colors.outline} 
        />
      </TouchableOpacity>
    );
  };

  if (isLoading) {
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
      
      <View style={styles.headerSection}>
        <Text style={styles.title}>Choose Your Avatar</Text>
        <Text style={styles.subtitle}>Select the identity you wish to wear as you journey through the realm.</Text>
      </View>

      {profiles && profiles.length > 0 ? (
        <FlatList
          data={profiles}
          renderItem={renderProfileItem}
          keyExtractor={(item) => item.profile_id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>📜</Text>
          <Text style={styles.emptyText}>No heroes have been forged yet.</Text>
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
  headerSection: {
    padding: Spacing[6],
    backgroundColor: Colors.surfaceContainerLowest,
  },
  title: {
    fontFamily: Fonts.heroic,
    fontSize: 24,
    color: Colors.onSurface,
    marginBottom: Spacing[2],
  },
  subtitle: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
    lineHeight: 20,
  },
  listContent: {
    padding: Spacing[4],
    gap: Spacing[4],
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
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.surfaceVariant,
  },
  profileImagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.surfaceVariant,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderEmoji: {
    fontSize: 24,
  },
  activeBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: Colors.surface,
    borderRadius: 10,
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
  }
});
