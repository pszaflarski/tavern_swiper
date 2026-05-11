import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Alert,
  Dimensions,
  useWindowDimensions,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Fonts, Spacing } from '../../theme';
import { PROFILE } from '../../constants';
import { useCreateProfile, useUpdateProfile, useProfile, useUploadProfileImage, ProfileTag } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { Ionicons } from '@expo/vector-icons';
import { ImageCropperModal } from '../../components/ImageCropperModal';
import { useImageSlots } from './useImageSlots';
import { prepareImageUpload } from '../../lib/imageProcessing';
import { TagPicker, ProfileTagData } from '../../components/TagPicker';
import * as FileSystem from 'expo-file-system';
import { styles } from './styles';

const GRID_SPACING = PROFILE.GRID_SPACING;
const MAX_ITEM_WIDTH = PROFILE.MAX_ITEM_WIDTH;

export default function CreateAndEditProfileScreen() {
  const { width } = useWindowDimensions();
  const ITEM_WIDTH = Math.min((width - Spacing[6] * 2 - GRID_SPACING * 3) / 3, MAX_ITEM_WIDTH);
  const ITEM_HEIGHT = ITEM_WIDTH * (16 / 9);
  
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { user } = useUser();
  const isEditing = !!id;

  const { data: existingProfile, isLoading: isLoadingProfile } = useProfile(id);
  const createProfile = useCreateProfile();
  const updateProfile = useUpdateProfile();

  const [displayName, setDisplayName] = useState('');
  const [tagline, setTagline] = useState('');
  const [bio, setBio] = useState('');
  const [age, setAge] = useState<string>('');
  const [isOC, setIsOC] = useState(false);
  const [genderTags, setGenderTags] = useState<ProfileTagData[]>([]);
  const [fandomTags, setFandomTags] = useState<ProfileTagData[]>([]);
  const [interestsTags, setInterestsTags] = useState<ProfileTagData[]>([]);
  const [raceTags, setRaceTags] = useState<ProfileTagData[]>([]);
  const [eventsTags, setEventsTags] = useState<ProfileTagData[]>([]);
  const {
    imageUrls,
    setImageUrls,
    isCropperVisible,
    setIsCropperVisible,
    pendingImageUri,
    setPendingImageUri,
    setActiveSlotIndex,
    pickImage,
    handleCropComplete,
    removeImage,
    cleanupCache,
  } = useImageSlots();

  // Initialise form if editing
  useEffect(() => {
    if (existingProfile) {
      setDisplayName(existingProfile.display_name || '');
      setTagline(existingProfile.tagline || '');
      setBio(existingProfile.bio || '');
      setAge(existingProfile.age != null ? String(existingProfile.age) : '');
      setIsOC(existingProfile.is_oc ?? false);
      setGenderTags((existingProfile.gender || []).map(t => ({ id: t.id, category: t.category, name: t.name, slug: t.slug, status: t.status })));
      setFandomTags((existingProfile.fandom || []).map(t => ({ id: t.id, category: t.category, name: t.name, slug: t.slug, status: t.status })));
      setInterestsTags((existingProfile.interests || []).map(t => ({ id: t.id, category: t.category, name: t.name, slug: t.slug, status: t.status })));
      setRaceTags((existingProfile.race || []).map(t => ({ id: t.id, category: t.category, name: t.name, slug: t.slug, status: t.status })));
      setEventsTags((existingProfile.events || []).map(t => ({ id: t.id, category: t.category, name: t.name, slug: t.slug, status: t.status })));
      setImageUrls(existingProfile.image_urls || []);
    }
  }, [existingProfile]);

  const uploadImage = useUploadProfileImage();
  const [isUploading, setIsUploading] = useState(false);

  const handleSave = async () => {
    if (!displayName.trim()) {
      const msg = 'Your hero must have a name to be remembered.';
      if (Platform.OS === 'web') {
        window.alert(`Incomplete Ritual\n\n${msg}`);
      } else {
        Alert.alert('Incomplete Ritual', msg);
      }
      return;
    }

    // Identify which images need uploading (those that are local URIs)
    // We assume anything starting with 'http' (and NOT 'blob:') is already permanent
    const newImagesToUpload = imageUrls.map((uri, index) => ({ uri, index }))
      .filter(({ uri }) => uri && (uri.startsWith('blob:') || uri.startsWith('file:') || !uri.startsWith('http')));

    // Build the initial payload — only include permanently hosted URLs.
    // Local blob:/file: URIs are excluded; they'll be uploaded in the next step.
    const permanentImageUrls = imageUrls.filter(
      (uri) => uri && uri.startsWith('http') && !uri.startsWith('blob:')
    );

    const payload: Record<string, any> = {
      display_name: displayName,
      tagline,
      bio,
      gender: genderTags,
      fandom: fandomTags,
      interests: interestsTags,
      race: raceTags,
      events: eventsTags,
      is_oc: isOC,
      image_urls: permanentImageUrls,
    };
    if (age.trim()) payload.age = parseInt(age, 10);

    try {
      let profileId = id;
      
      // 1. Create or Update Metadata
      if (isEditing && id) {
        await updateProfile.mutateAsync({ profileId: id, data: payload });
      } else {
        const newProfile = await createProfile.mutateAsync(payload);
        profileId = newProfile.profile_id;
      }

      // 2. Handle Image Uploads if any
      if (newImagesToUpload.length > 0 && profileId) {
        setIsUploading(true);
        const uploadedUris: string[] = [];
        
        for (const { uri, index } of newImagesToUpload) {
          try {
            const file = await prepareImageUpload(uri, index);
            await uploadImage.mutateAsync({ profileId, index, file: file as any });
            uploadedUris.push(uri);
          } catch (uploadErr) {
            console.error(`Failed to upload vision at index ${index}`, uploadErr);
          }
        }
        
        // Final Purge: Clean up transient mobile assets
        await cleanupCache(uploadedUris);
        setIsUploading(false);
      }

      router.back();
    } catch (err) {
      setIsUploading(false);
      const msg = 'The summoning spell could not be completed. Try again.';
      if (Platform.OS === 'web') {
        window.alert(`Magic Failed\n\n${msg}`);
      } else {
        Alert.alert('Magic Failed', msg);
      }
    }
  };

  const isPending = createProfile.isPending || updateProfile.isPending;

  if (isEditing && isLoadingProfile) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Recalling the legend...</Text>
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      bottomOffset={62} // Ensures active input has room above the keyboard
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: isEditing ? 'Alter Your Path' : 'Forge Your Hero',
          headerShown: true,
          headerStyle: { backgroundColor: Colors.surfaceContainerLowest },
          headerTitleStyle: { fontFamily: Fonts.heroic, color: Colors.onSurface },
          headerTintColor: Colors.primary,
          headerLeft: () => (
            <Pressable 
              onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/profiles' as any)} 
              style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.7 }]}
              testID="profile-header-close-button"
            >
              <Ionicons name="close" size={24} color={Colors.outline} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={handleSave}
              disabled={isPending}
              style={({ pressed }) => [
                styles.headerButton,
                (isPending || pressed) && { opacity: 0.7 }
              ]}
              testID="profile-header-save-button"
              accessibilityLabel="Save profile"
              accessibilityRole="button"
            >
              {isPending ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Text style={styles.saveActionText}>Save</Text>
              )}
            </Pressable>
          ),
        }}
      />

      {/* Enchanted Image Grid */}
      <View style={styles.gridSection}>
        <Text style={styles.sectionTitle}>Visions of the Self</Text>
        <View style={styles.imageGrid}>
          {[...Array(6)].map((_, index) => {
            const uri = imageUrls[index];
            return (
              <View key={index} style={{ width: ITEM_WIDTH, height: ITEM_HEIGHT }} testID={`profile-image-slot-${index}`}>
                {uri ? (
                  <View style={styles.filledSlot} testID={`profile-image-filled-${index}`}>
                    <Image
                      source={{ uri }}
                      style={styles.gridImage}
                      resizeMode="cover"
                    />
                    <Pressable
                      style={({ pressed }) => [
                        styles.removeSeal,
                        pressed && { opacity: 0.7 }
                      ]}
                      onPress={() => removeImage(index)}
                      testID={`profile-image-remove-${index}`}
                      accessibilityLabel={`Remove image ${index + 1}`}
                      accessibilityRole="button"
                    >
                      <Ionicons name="close-circle" size={20} color={Colors.error} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    style={({ pressed }) => [
                      styles.emptySlot,
                      pressed && { opacity: 0.7 }
                    ]}
                    onPress={() => pickImage(index)}
                    testID={`profile-image-add-button-${index}`}
                    accessibilityLabel={`Add image to slot ${index + 1}`}
                    accessibilityRole="button"
                  >
                    <View style={styles.emptySlotContent}>
                      <Ionicons name="camera" size={24} color={Colors.surfaceVariant} />
                      <Text style={styles.addLabel}>Add</Text>
                    </View>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
        <Text style={styles.gridHint}>Tap to reveal your hero's appearance (Max 6)</Text>
      </View>

      {/* Identity Section */}
      <View style={styles.formSection}>
        <Text style={styles.sectionTitle}>Identity</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>True Name</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            testID="profile-name-input"
            onChangeText={setDisplayName}
            placeholder="e.g. Elara Brightsoul"
            placeholderTextColor={Colors.surfaceVariant}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Title / Tagline</Text>
          <TextInput
            style={styles.input}
            value={tagline}
            testID="profile-tagline-input"
            onChangeText={setTagline}
            placeholder="e.g. Keeper of the Ancient Light"
            placeholderTextColor={Colors.surfaceVariant}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Chronicle (Bio)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={bio}
            testID="profile-bio-input"
            onChangeText={setBio}
            placeholder="Tell your tale..."
            placeholderTextColor={Colors.surfaceVariant}
            multiline
            numberOfLines={4}
          />
        </View>
      </View>

      {/* Attributes Section */}
      <View style={styles.formSection}>
        <Text style={styles.sectionTitle}>Attributes</Text>

        <TagPicker
          category="gender"
          label="Gender / Essence"
          multiSelect={false}
          selectedTags={genderTags}
          onTagsChange={setGenderTags}
          testIDPrefix="profile-gender"
        />

        <TagPicker
          category="fandom"
          label="Fandoms"
          multiSelect={true}
          selectedTags={fandomTags}
          onTagsChange={setFandomTags}
          testIDPrefix="profile-fandom"
        />

        <TagPicker
          category="interests"
          label="Interests"
          multiSelect={true}
          selectedTags={interestsTags}
          onTagsChange={setInterestsTags}
          testIDPrefix="profile-interests"
        />

        <TagPicker
          category="race"
          label="Race / Species"
          multiSelect={true}
          selectedTags={raceTags}
          onTagsChange={setRaceTags}
          testIDPrefix="profile-race"
        />

        <TagPicker
          category="events"
          label="Events"
          multiSelect={true}
          selectedTags={eventsTags}
          onTagsChange={setEventsTags}
          testIDPrefix="profile-events"
        />

        {/* Age & OC */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Age</Text>
          <TextInput
            style={[styles.input, { width: 100 }]}
            value={age}
            onChangeText={(text) => setAge(text.replace(/[^0-9]/g, ''))}
            placeholder="e.g. 25"
            placeholderTextColor={Colors.surfaceVariant}
            keyboardType="number-pad"
            maxLength={3}
            testID="profile-age-input"
          />
        </View>

        <View style={styles.inputGroup}>
          <Pressable
            style={({ pressed }) => [
              styles.ocToggleRow,
              pressed && { opacity: 0.7 }
            ]}
            onPress={() => setIsOC(!isOC)}
            testID="profile-oc-toggle"
          >
            <View style={[styles.ocCheckbox, isOC && styles.ocCheckboxActive]}>
              {isOC && <Ionicons name="checkmark" size={14} color={Colors.onPrimary} />}
            </View>
            <Text style={styles.ocLabel}>Original Character (OC)</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.forgeButton, 
          isPending && styles.forgeButtonDisabled,
          pressed && !isPending && { opacity: 0.8 }
        ]}
        onPress={handleSave}
        testID="profile-forge-button"
        disabled={isPending}
      >
        {isPending || isUploading ? (
          <ActivityIndicator color={Colors.onPrimary} />
        ) : (
          <>
            <Ionicons name="flash" size={20} color={Colors.onPrimary} style={{ marginRight: 8 }} />
            <Text style={styles.forgeButtonText}>
              {isEditing ? 'Confirm Alteration' : 'Forge Identity'}
            </Text>
          </>
        )}
      </Pressable>

      {Platform.OS === 'web' && (
        <input
          type="file"
          multiple
          data-testid="hidden-image-upload"
          style={{ display: 'none' }}
          onChange={(e: any) => {
            const files = Array.from(e.target.files || []);
            if (files.length > 0) {
              const uri = URL.createObjectURL(files[0] as any);
              setPendingImageUri(uri);
              setActiveSlotIndex(imageUrls.length);
              setIsCropperVisible(true);
            }
          }}
        />
      )}
      
      {/* <TouchableOpacity 
        style={{ backgroundColor: '#444', padding: 10, margin: 10, borderRadius: 5, alignItems: 'center' }}
        onPress={() => {
          setPendingImageUri('https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=1000');
          setActiveSlotIndex(0);
          setIsCropperVisible(true);
        }}
        testID="test-gesture-button"
      >
        <Text style={{ color: '#fff' }}>[DEBUG] Ritual Practice (Test Gestures)</Text>
      </TouchableOpacity> */}

      <ImageCropperModal
        isVisible={isCropperVisible}
        imageUri={pendingImageUri}
        onClose={() => setIsCropperVisible(false)}
        onCropComplete={handleCropComplete}
      />

      <View style={styles.footerPlaceholder} />
    </KeyboardAwareScrollView>
  );
}

