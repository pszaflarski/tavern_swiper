import React, { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Colors, Fonts, Radius, Spacing, Shadow } from '../../theme';
import { useUser } from '../../hooks/useUser';
import { useProfiles, useCreateProfile, useUpdateProfile, useUploadProfileImage, Profile } from '../../hooks/useProfiles';
import CharacterProfile from '../../components/CharacterProfile';
import { auth } from '../../lib/firebase';
import { useActiveProfile } from '../../lib/ActiveProfileContext';

type Mode = 'list' | 'create' | 'edit';

export default function ProfilesScreen() {
  const { user } = useUser();
  const { data: profiles, isLoading, refetch } = useProfiles(user?.uid);
  const createProfile = useCreateProfile();
  const updateProfile = useUpdateProfile();
  const uploadProfileImage = useUploadProfileImage();
  const { activeProfileId, setActiveProfileId } = useActiveProfile();

  const [mode, setMode] = useState<Mode>('list');
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    display_name: '',
    bio: '',
    gender: '',
    image_url: '',
    image_urls: [] as string[],
    tagline: 'A new hero arises.',
    character_class: 'Adventurer',
    realm: 'Fort Tavern',
  });

  // Auto-select first profile if none is active
  React.useEffect(() => {
    if (!isLoading && !activeProfileId && profiles && profiles.length > 0) {
      setActiveProfileId(profiles[0].profile_id);
    }
  }, [isLoading, activeProfileId, profiles, setActiveProfileId]);

  const handleStartCreate = () => {
    setFormData({
      display_name: '',
      bio: '',
      gender: '',
      image_url: '',
      image_urls: [],
      tagline: 'A new hero arises.',
      character_class: 'Adventurer',
      realm: 'Fort Tavern',
    });
    setMode('create');
  };

  const handleStartEdit = (profile: Profile) => {
    setEditingProfile(profile);
    setFormData({
      display_name: profile.display_name,
      bio: profile.bio || '',
      gender: profile.gender || '',
      image_url: profile.image_url || '',
      image_urls: profile.image_urls || [],
      tagline: profile.tagline || '',
      character_class: profile.character_class || '',
      realm: profile.realm || '',
    });
    setMode('edit');
  };

  const pickImage = async (index: number) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.8,
    });

    if (!result.canceled) {
      setFormData((prev) => {
        const newUrls = [...(prev.image_urls || [])];
        while (newUrls.length <= index) newUrls.push('');
        newUrls[index] = result.assets[0].uri;
        
        // If it's the first image, also update the primary image_url
        if (index === 0) {
          return { ...prev, image_url: result.assets[0].uri, image_urls: newUrls };
        }
        return { ...prev, image_urls: newUrls };
      });
    }
  };

  const handleSave = async () => {
    if (!user) return;

    setIsSaving(true);

    try {
      let currentProfileId = '';
      const isLocalImage = !!formData.image_url && !formData.image_url.startsWith('http');

      if (mode === 'create') {
        const profileData = {
          ...formData,
          image_url: '',
          // user_id: user.uid,
          talents: ['Navigation'],
          attributes: { strength: 5, charisma: 5, spark: 5 },
        };
        const newProfile = await createProfile.mutateAsync(profileData as any);
        currentProfileId = newProfile.profile_id;
      } else if (mode === 'edit' && editingProfile) {
        currentProfileId = editingProfile.profile_id;
        const updateData = { ...formData };
        if (isLocalImage) updateData.image_url = editingProfile.image_url || '';

        await updateProfile.mutateAsync({
          profileId: currentProfileId,
          data: updateData,
        });
      }

      // Upload all local images
      const uploadPromises = (formData.image_urls || []).map(async (uri, idx) => {
        if (uri && !uri.startsWith('http')) {
          return uploadProfileImage.mutateAsync({
            profileId: currentProfileId,
            uri,
            index: idx,
          });
        }
        return Promise.resolve();
      });
      
      // Also check the primary image_url if it was set explicitly (backward compatibility)
      if (formData.image_url && !formData.image_url.startsWith('http')) {
        const alreadyUploadingFirst = formData.image_urls[0] === formData.image_url;
        if (!alreadyUploadingFirst) {
          uploadPromises.push(
            uploadProfileImage.mutateAsync({
              profileId: currentProfileId,
              uri: formData.image_url,
              index: 0,
            }) as any
          );
        }
      }

      await Promise.all(uploadPromises);

      // If we just created the first profile, or if there is no active profile, select this one
      if (mode === 'create' || !activeProfileId) {
        setActiveProfileId(currentProfileId);
      }

      setMode('list');
      await refetch();
    } catch (error) {
      console.error('Failed to save profile:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const renderProfileItem = ({ item }: { item: Profile }) => {
    const isActive = activeProfileId === item.profile_id;
    
    return (
      <View style={styles.profileCardWrapper}>
        <TouchableOpacity
          style={[styles.profileCard, isActive && styles.profileCardActive]}
          onPress={() => handleStartEdit(item)}
          activeOpacity={0.8}
        >
          <View style={styles.profileCardImageContainer}>
            {item.image_url ? (
              <Image source={{ uri: item.image_url }} style={styles.profileCardImage} />
            ) : (
              <Text style={{ fontSize: 24 }}>🛡️</Text>
            )}
          </View>
          <View style={styles.profileCardContent}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing[2] }}>
              <Text style={styles.profileCardName} testID="profile-card-name">{item.display_name}</Text>
              {isActive && (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>ACTIVE</Text>
                </View>
              )}
            </View>
            <Text style={styles.profileCardClass}>{item.character_class}</Text>
            {item.gender && <Text style={styles.profileCardGender}>{item.gender}</Text>}
          </View>
          <Text style={styles.editIcon}>🖊️</Text>
        </TouchableOpacity>
        
        {!isActive && (
          <TouchableOpacity 
            style={styles.selectActiveButton}
            onPress={() => setActiveProfileId(item.profile_id)}
          >
            <Text style={styles.selectActiveButtonText}>SWAP TO THIS IDENTITY</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  if (mode === 'list') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Your Identities</Text>
          <Text style={styles.headerSub}>Choose your path</Text>
        </View>

        <FlatList
          data={profiles}
          keyExtractor={(p) => p.profile_id}
          renderItem={renderProfileItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>You have no heroes to your name yet.</Text>
            </View>
          }
        />

        <View style={styles.footer}>
          <TouchableOpacity style={styles.createButton} onPress={handleStartCreate} testID="forge-new-identity-button">
            <Text style={styles.createButtonText}>Forge New Identity</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.createButton, { marginTop: Spacing[4], backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.outlineVariant }]}
            onPress={() => auth.signOut()}
          >
            <Text style={[styles.createButtonText, { color: Colors.error }]}>Log Out</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.formContent}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setMode('list')} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{mode === 'create' ? 'New Hero' : 'Edit Hero'}</Text>
      </View>
      <View style={styles.form}>
        {/* Portrait Grid at the Top */}
        <View style={styles.imageGridContainer}>
          <Text style={[styles.label, { marginBottom: Spacing[4] }]}>Hero's Portraits (Up to 6)</Text>
          <View style={styles.imageGrid}>
            {(() => {
              const displayUrls = (formData.image_urls || []).filter(url => !!url);
              const slots = [...displayUrls];
              if (slots.length < 6) {
                slots.push(''); // Add the next upload slot
              }
              
              return slots.map((url, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.gridItem}
                  onPress={() => pickImage(index)}
                  testID={`identity-image-slot-${index}`}
                >
                  {url ? (
                    <Image source={{ uri: url }} style={styles.gridImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.gridPlaceholder}>
                      <Text style={styles.gridPlaceholderText}>+</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ));
            })()}
          </View>
          {__DEV__ && (
            <TouchableOpacity
              style={[styles.pickerButton, { backgroundColor: Colors.tertiaryContainer, marginTop: Spacing[4] }]}
              onPress={() => {
                const mock = 'https://placehold.co/600x400/3e2723/ffffff?text=Hero';
                setFormData(prev => ({ 
                  ...prev, 
                  image_url: mock, 
                  image_urls: [mock, mock, mock, mock, mock, mock] 
                }))
              }}
              testID="identity-mock-image-button"
            >
              <Text style={[styles.pickerButtonText, { color: Colors.onTertiaryContainer }]}>
                (DEV) Fill All with Mocks
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.label}>True Name</Text>
        <TextInput
          style={styles.input}
          value={formData.display_name}
          onChangeText={(text) => setFormData({ ...formData, display_name: text })}
          placeholder="e.g. Valerius the Bold"
          placeholderTextColor={Colors.outline}
          testID="identity-name-input"
        />

        <Text style={styles.label}>Hero's Lore (Bio)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={formData.bio}
          onChangeText={(text) => setFormData({ ...formData, bio: text })}
          placeholder="Tell your tale..."
          placeholderTextColor={Colors.outline}
          multiline
          numberOfLines={4}
          testID="identity-bio-input"
        />

        <Text style={styles.label}>Gender / Essence</Text>
        <TextInput
          style={styles.input}
          value={formData.gender}
          onChangeText={(text) => setFormData({ ...formData, gender: text })}
          placeholder="e.g. Masculine, Feminine, Celestial..."
          placeholderTextColor={Colors.outline}
          testID="identity-gender-input"
        />


        <TouchableOpacity
          style={[styles.saveButton, isSaving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={isSaving}
          testID="identity-save-button"
        >
          {isSaving ? (
            <ActivityIndicator color={Colors.onSecondary} />
          ) : (
            <Text style={styles.saveButtonText}>Seal with Wax</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
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
  },
  header: {
    paddingTop: Spacing[16],
    paddingBottom: Spacing[6],
    paddingHorizontal: Spacing[6],
    backgroundColor: Colors.surfaceContainerLowest,
  },
  headerTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 28,
    color: Colors.primary,
  },
  headerSub: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  listContent: {
    padding: Spacing[6],
    gap: Spacing[4],
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing[4],
    ...Shadow.waxSeal,
  },
  profileCardWrapper: {
    gap: Spacing[2],
  },
  profileCardActive: {
    borderColor: Colors.tertiary,
    borderWidth: 1,
    backgroundColor: Colors.surfaceContainer,
  },
  activeBadge: {
    backgroundColor: Colors.tertiary,
    paddingHorizontal: Spacing[2],
    paddingVertical: 2,
    borderRadius: Radius.xs,
  },
  activeBadgeText: {
    color: Colors.onTertiary,
    fontFamily: Fonts.scribe,
    fontSize: 9,
    fontWeight: '700',
  },
  selectActiveButton: {
    backgroundColor: Colors.surfaceContainerHighest,
    paddingVertical: Spacing[2],
    alignItems: 'center',
    borderRadius: Radius.md,
    opacity: 0.8,
  },
  selectActiveButtonText: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    color: Colors.primary,
    letterSpacing: 1,
  },
  profileCardImageContainer: {
    width: 60,
    height: 60,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainerHighest,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  profileCardImage: {
    width: '100%',
    height: '100%',
  },
  profileCardContent: {
    flex: 1,
    marginLeft: Spacing[4],
  },
  profileCardName: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.onSurface,
  },
  profileCardClass: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    textTransform: 'uppercase',
  },
  profileCardGender: {
    fontFamily: Fonts.scribe,
    fontSize: 11,
    color: Colors.tertiary,
    marginTop: 2,
  },
  editIcon: {
    fontSize: 20,
    opacity: 0.5,
  },
  emptyContainer: {
    padding: Spacing[10],
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: Fonts.scribe,
    color: Colors.outline,
    textAlign: 'center',
  },
  footer: {
    padding: Spacing[6],
    paddingBottom: Spacing[10],
  },
  createButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingVertical: Spacing[4],
    alignItems: 'center',
    ...Shadow.waxSeal,
  },
  createButtonText: {
    fontFamily: Fonts.heroic,
    fontSize: 16,
    color: Colors.onPrimary,
    fontWeight: '600',
  },
  formContent: {
    paddingBottom: Spacing[12],
  },
  backButton: {
    marginBottom: Spacing[4],
  },
  backButtonText: {
    fontFamily: Fonts.scribe,
    color: Colors.primary,
  },
  form: {
    padding: Spacing[6],
    gap: Spacing[4],
  },
  inputContainer: {
    gap: Spacing[3],
  },
  label: {
    fontFamily: Fonts.heroic,
    fontSize: 14,
    color: Colors.onSurface,
    marginBottom: -Spacing[2],
  },
  input: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    padding: Spacing[4],
    fontFamily: Fonts.scribe,
    color: Colors.onSurface,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  previewImage: {
    width: '100%',
    height: 250,
    borderRadius: Radius.md,
  },
  previewPlaceholder: {
    backgroundColor: Colors.surfaceContainerHighest,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.outline,
  },
  pickerButton: {
    borderRadius: Radius.full,
    paddingVertical: Spacing[4],
    alignItems: 'center',
  },
  pickerButtonText: {
    fontFamily: Fonts.scribe,
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: Colors.secondary,
    borderRadius: Radius.full,
    paddingVertical: Spacing[4],
    alignItems: 'center',
    marginTop: Spacing[6],
    ...Shadow.waxSeal,
  },
  saveButtonText: {
    fontFamily: Fonts.scribe,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.onSecondary,
  },
  imageGridContainer: {
    marginBottom: Spacing[6],
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing[2],
  },
  gridItem: {
    width: '23%',
    aspectRatio: 1,
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  gridPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridPlaceholderText: {
    fontSize: 32,
    color: Colors.outline,
    fontFamily: Fonts.scribe,
  },
});
