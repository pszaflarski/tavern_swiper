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
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Fonts, Radius, Spacing, Shadow } from '../../theme';
import { useUser } from '../../hooks/useUser';
import { useProfiles, useCreateProfile, useUpdateProfile, useUploadProfileImage, Profile } from '../../hooks/useProfiles';
import CharacterProfile from '../../components/CharacterProfile';
import { SwipeCard } from '../../components/SwipeDeck';
import { auth } from '../../lib/firebase';
import { useActiveProfile } from '../../lib/ActiveProfileContext';

type Mode = 'list' | 'create' | 'edit';

export default function ProfilesScreen() {
  const router = useRouter();
  const { user } = useUser();
  const { data: profiles, isLoading, refetch } = useProfiles(user?.uid);
  const createProfile = useCreateProfile();
  const updateProfile = useUpdateProfile();
  const uploadProfileImage = useUploadProfileImage();
  const { activeProfileId, setActiveProfileId } = useActiveProfile();

  const [mode, setMode] = useState<Mode>('list');
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [formData, setFormData] = useState({
    display_name: '',
    bio: '',
    gender: '',
    image_url: '',
    image_urls: [] as string[],
    tagline: 'A new hero arises.',
    character_class: 'Adventurer',
    realm: 'Fort Tavern',
    talents: 'Navigation',
    strength: 5,
    charisma: 5,
    spark: 5,
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
      talents: 'Navigation',
      strength: 5,
      charisma: 5,
      spark: 5,
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
      talents: profile.talents?.join(', ') || '',
      strength: profile.attributes?.strength || 5,
      charisma: profile.attributes?.charisma || 5,
      spark: profile.attributes?.spark || 5,
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
          talents: formData.talents.split(',').map(s => s.trim()).filter(s => s !== ''),
          attributes: { 
            strength: Number(formData.strength), 
            charisma: Number(formData.charisma), 
            spark: Number(formData.spark) 
          },
        };
        const newProfile = await createProfile.mutateAsync(profileData as any);
        currentProfileId = newProfile.profile_id;
      } else if (mode === 'edit' && editingProfile) {
        currentProfileId = editingProfile.profile_id;
        const updateData = { 
          ...formData,
          talents: formData.talents.split(',').map(s => s.trim()).filter(s => s !== ''),
          attributes: { 
            strength: Number(formData.strength), 
            charisma: Number(formData.charisma), 
            spark: Number(formData.spark) 
          },
        };
        if (isLocalImage) updateData.image_url = editingProfile.image_url || '';

        await updateProfile.mutateAsync({
          profileId: currentProfileId,
          data: updateData as any,
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
    } catch (error: any) {
      console.error('Failed to save profile or upload portraits:', error);
      if (error.response) {
        console.error('SERVER ERROR DETAIL:', JSON.stringify(error.response.data, null, 2));
      }
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
            {!!item.gender && <Text style={styles.profileCardGender}>{item.gender}</Text>}
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

          {(user?.user_type === 'admin' || user?.user_type === 'root_admin') && (
            <TouchableOpacity
              style={[styles.createButton, { marginTop: Spacing[8], backgroundColor: Colors.surfaceContainerHigh, borderColor: Colors.tertiary, borderWidth: 1 }]}
              onPress={() => router.push('/admin')}
            >
              <Text style={[styles.createButtonText, { color: Colors.tertiary }]}>Nexus Admin Panel</Text>
            </TouchableOpacity>
          )}
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
        </View>

        <Text style={[styles.sectionHeader, { marginTop: 0 }]}>Heroic Identity</Text>
        
        <View style={styles.inputContainer}>
          <Text style={styles.label}>True Name</Text>
          <TextInput
            style={styles.input}
            value={formData.display_name}
            onChangeText={(text) => setFormData({ ...formData, display_name: text })}
            placeholder="e.g. Valerius the Bold"
            placeholderTextColor={Colors.outline}
            testID="identity-name-input"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Hero's Class</Text>
          <TextInput
            style={styles.input}
            value={formData.character_class}
            onChangeText={(text) => setFormData({ ...formData, character_class: text })}
            placeholder="e.g. Knight, Rogue, Mage..."
            placeholderTextColor={Colors.outline}
            testID="identity-class-input"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Hero's Tagline</Text>
          <TextInput
            style={styles.input}
            value={formData.tagline}
            onChangeText={(text) => setFormData({ ...formData, tagline: text })}
            placeholder="e.g. Born for the blade."
            placeholderTextColor={Colors.outline}
            testID="identity-tagline-input"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Hero's Realm</Text>
          <TextInput
            style={styles.input}
            value={formData.realm}
            onChangeText={(text) => setFormData({ ...formData, realm: text })}
            placeholder="e.g. Fort Tavern"
            placeholderTextColor={Colors.outline}
            testID="identity-realm-input"
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.label}>Gender / Essence</Text>
          <TextInput
            style={styles.input}
            value={formData.gender}
            onChangeText={(text) => setFormData({ ...formData, gender: text })}
            placeholder="e.g. Masculine, Feminine, Celestial..."
            placeholderTextColor={Colors.outline}
            testID="identity-gender-input"
          />
        </View>

        <Text style={styles.sectionHeader}>Heroic Attributes</Text>
        <View style={styles.attributesRow}>
          <View style={styles.attributeField}>
            <Text style={styles.label}>Strength</Text>
            <TextInput
              style={styles.input}
              value={String(formData.strength)}
              onChangeText={(text) => setFormData({ ...formData, strength: parseInt(text) || 0 })}
              keyboardType="numeric"
              maxLength={2}
              testID="identity-strength-input"
            />
          </View>
          <View style={styles.attributeField}>
            <Text style={styles.label}>Charisma</Text>
            <TextInput
              style={styles.input}
              value={String(formData.charisma)}
              onChangeText={(text) => setFormData({ ...formData, charisma: parseInt(text) || 0 })}
              keyboardType="numeric"
              maxLength={2}
              testID="identity-charisma-input"
            />
          </View>
          <View style={styles.attributeField}>
            <Text style={styles.label}>Spark</Text>
            <TextInput
              style={styles.input}
              value={String(formData.spark)}
              onChangeText={(text) => setFormData({ ...formData, spark: parseInt(text) || 0 })}
              keyboardType="numeric"
              maxLength={2}
              testID="identity-spark-input"
            />
          </View>
        </View>

        <Text style={styles.sectionHeader}>Heroic Talents</Text>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            value={formData.talents}
            onChangeText={(text) => setFormData({ ...formData, talents: text })}
            placeholder="e.g. Navigation, Stealth, Alchemy"
            placeholderTextColor={Colors.outline}
            testID="identity-talents-input"
          />
          <Text style={styles.fieldHint}>Separate with commas</Text>
        </View>

        <Text style={styles.sectionHeader}>Heroic Lore</Text>
        <View style={styles.inputContainer}>
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
        </View>


        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: Colors.surfaceVariant, marginTop: Spacing[2] }]}
          onPress={() => setShowPreview(true)}
          testID="identity-preview-button"
        >
          <Text style={[styles.saveButtonText, { color: Colors.onSurfaceVariant }]}>Preview Hero</Text>
        </TouchableOpacity>

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

      <Modal
        visible={showPreview}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowPreview(false)}
      >
        <View style={styles.previewModalContainer}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewHeaderTitle}>Hero Discovery Preview</Text>
            <TouchableOpacity onPress={() => setShowPreview(false)} style={styles.closePreviewButton}>
              <Text style={styles.closePreviewText}>✕</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.previewDeckWrapper}>
            <View style={{ height: 500, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
              <SwipeCard
                profile={{
                  profile_id: 'preview',
                  display_name: formData.display_name || 'Unnamed Hero',
                  tagline: formData.tagline,
                  character_class: formData.character_class,
                  realm: formData.realm,
                  image_url: formData.image_url || (formData.image_urls.length > 0 ? formData.image_urls[0] : ''),
                  talents: formData.talents.split(',').map(s => s.trim()).filter(s => s !== ''),
                }}
                isTop={true}
                index={0}
                onSwipeLeft={() => setShowPreview(false)}
                onSwipeRight={() => setShowPreview(false)}
              />
            </View>

            <View style={styles.previewActionRow}>
              <TouchableOpacity 
                style={[styles.roundButton, { borderColor: Colors.error }]} 
                onPress={() => setShowPreview(false)}
              >
                <Text style={[styles.roundButtonText, { color: Colors.error }]}>✕</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.roundButton, { borderColor: Colors.tertiary, transform: [{ scale: 1.2 }] }]} 
                onPress={() => setShowPreview(false)}
              >
                <Text style={[styles.roundButtonText, { color: Colors.tertiary }]}>❤️</Text>
              </TouchableOpacity>
            </View>
            
            <Text style={styles.previewInstructions}>
              This is how your hero appears to others during discovery. 
              Swipe left or right (or use the buttons) to return to your forge.
            </Text>
          </View>
        </View>
      </Modal>
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
  sectionHeader: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.primary,
    marginTop: Spacing[6],
    marginBottom: Spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
    paddingBottom: Spacing[1],
  },
  attributesRow: {
    flexDirection: 'row',
    gap: Spacing[4],
    justifyContent: 'space-between',
  },
  attributeField: {
    flex: 1,
    gap: Spacing[2],
  },
  fieldHint: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    color: Colors.outline,
    marginTop: -Spacing[2],
  },
  inputContainer: {
    gap: Spacing[2],
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
    gap: Spacing[4],
    justifyContent: 'flex-start',
  },
  gridItem: {
    width: '30.5%',
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
  previewModalContainer: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing[16],
    paddingBottom: Spacing[4],
    paddingHorizontal: Spacing[6],
    backgroundColor: Colors.surfaceContainerLowest,
  },
  previewHeaderTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 22,
    color: Colors.primary,
  },
  closePreviewButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceContainerHighest,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closePreviewText: {
    fontSize: 18,
    color: Colors.onSurface,
  },
  previewDeckWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing[4],
  },
  previewActionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing[10],
    marginTop: Spacing[6],
    marginBottom: Spacing[4],
  },
  roundButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    backgroundColor: Colors.surfaceContainerLowest,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadow.waxSeal,
  },
  roundButtonText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  previewInstructions: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    textAlign: 'center',
    paddingHorizontal: Spacing[8],
    marginTop: Spacing[4],
    fontStyle: 'italic',
  },
});
