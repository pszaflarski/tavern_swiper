import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
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
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';
import { useCreateProfile, useUpdateProfile, useProfile, useUploadProfileImage } from '../../hooks/useProfiles';
import { useUser } from '../../hooks/useUser';
import { Ionicons } from '@expo/vector-icons';
import { ImageCropperModal } from '../../components/ImageCropperModal';
import { prepareImageUpload } from '../../lib/imageProcessing';
import * as FileSystem from 'expo-file-system';

const GRID_SPACING = Spacing[3];
const MAX_ITEM_WIDTH = 150; // Cap width to keep thumbnails small

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
  const [gender, setGender] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  
  // Image Processing State
  const [isCropperVisible, setIsCropperVisible] = useState(false);
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);
  const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null);

  // Initialise form if editing
  useEffect(() => {
    if (existingProfile) {
      setDisplayName(existingProfile.display_name || '');
      setTagline(existingProfile.tagline || '');
      setBio(existingProfile.bio || '');
      setGender(existingProfile.gender || '');
      setImageUrls(existingProfile.image_urls || []);
    }
  }, [existingProfile]);

  const pickImage = async (index: number) => {
    if (imageUrls.length >= 6 && !imageUrls[index]) {
      Alert.alert('Full Arsenal', 'A hero can only carry six relics of their past.');
      return;
    }

    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permissionResult.granted === false) {
      Alert.alert('Vision Denied', 'The camera roll requires your permission to reveal its secrets.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false, // Always false — our ImageCropperModal handles cropping uniformly
      quality: 1, // Keep original quality for the cropper; we compress in the pipeline
    });

    if (!result.canceled) {
      setPendingImageUri(result.assets[0].uri);
      setActiveSlotIndex(index);
      setIsCropperVisible(true);
    }
  };

  const handleCropComplete = (processedUri: string) => {
    const newImages = [...imageUrls];
    if (activeSlotIndex !== null) {
      newImages[activeSlotIndex] = processedUri;
    } else {
      newImages.push(processedUri);
    }
    setImageUrls(newImages);
  };

  const removeImage = (index: number) => {
    const newImages = [...imageUrls];
    newImages.splice(index, 1);
    setImageUrls(newImages);
  };

  const uploadImage = useUploadProfileImage();
  const [isUploading, setIsUploading] = useState(false);

  // Helper to convert local URIs to Blobs/Files for upload
  // Now uses the unified imageProcessing service
  const cleanupCache = async (uris: string[]) => {
    if (Platform.OS === 'web') return;
    for (const uri of uris) {
      if (uri.startsWith('file://')) {
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch (e) {
          console.warn('Failed to purge temporary vision:', uri);
        }
      }
    }
  };

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

    const payload = {
      display_name: displayName,
      tagline,
      bio,
      gender,
      image_urls: permanentImageUrls,
    };

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
            <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
              <Ionicons name="close" size={24} color={Colors.outline} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity
              onPress={handleSave}
              disabled={isPending}
              style={styles.headerButton}
              testID="profile-header-save-button"
              accessibilityLabel="Save profile"
              accessibilityRole="button"
            >
              {isPending ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Text style={styles.saveActionText}>Save</Text>
              )}
            </TouchableOpacity>
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
                    <TouchableOpacity
                      style={styles.removeSeal}
                      onPress={() => removeImage(index)}
                      testID={`profile-image-remove-${index}`}
                      accessibilityLabel={`Remove image ${index + 1}`}
                      accessibilityRole="button"
                    >
                      <Ionicons name="close-circle" size={20} color={Colors.error} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.emptySlot}
                    onPress={() => pickImage(index)}
                    testID={`profile-image-add-button-${index}`}
                    accessibilityLabel={`Add image to slot ${index + 1}`}
                    accessibilityRole="button"
                  >
                    <View style={styles.emptySlotContent}>
                      <Ionicons name="camera" size={24} color={Colors.surfaceVariant} />
                      <Text style={styles.addLabel}>Add</Text>
                    </View>
                  </TouchableOpacity>
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

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Gender / Essence</Text>
          <View style={styles.choiceRow}>
            {['Male', 'Female', 'Other'].map((opt) => (
              <TouchableOpacity
                key={opt}
                testID={`profile-gender-${opt}`}
                style={[styles.choiceBtn, gender === opt && styles.choiceBtnActive]}
                onPress={() => setGender(opt)}
              >
                <Text style={[styles.choiceText, gender === opt && styles.choiceTextActive]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.forgeButton, isPending && styles.forgeButtonDisabled]}
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
      </TouchableOpacity>

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
  },
  scrollContent: {
    padding: Spacing[6],
  },
  headerButton: {
    padding: 8,
  },
  saveActionText: {
    fontFamily: Fonts.heroic,
    fontSize: 16,
    color: Colors.primary,
  },
  gridSection: {
    alignItems: 'center',
    marginBottom: Spacing[8],
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: GRID_SPACING,
  },
  filledSlot: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.sm,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceContainerHigh,
    ...Shadow.waxSeal,
    borderWidth: 1.5,
    borderColor: Colors.tertiary,
  },
  emptySlot: {
    width: '100%',
    height: '100%',
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.outlineVariant,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptySlotContent: {
    alignItems: 'center',
  },
  addLabel: {
    fontFamily: Fonts.scribe,
    fontSize: 10,
    color: Colors.outline,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  removeSeal: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: Colors.surface,
    borderRadius: 10,
  },
  gridHint: {
    marginTop: Spacing[3],
    fontFamily: Fonts.scribe,
    fontSize: 12,
    fontStyle: 'italic',
    color: Colors.outline,
    textAlign: 'center',
  },
  formSection: {
    marginBottom: Spacing[8],
  },
  sectionTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.onSurface,
    marginBottom: Spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: Colors.outlineVariant,
    paddingBottom: Spacing[2],
  },
  inputGroup: {
    marginBottom: Spacing[4],
  },
  label: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
    marginBottom: Spacing[2],
    marginLeft: 4,
  },
  input: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing[3],
    color: Colors.onSurface,
    fontFamily: Fonts.scribe,
    fontSize: 15,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  choiceRow: {
    flexDirection: 'row',
    gap: Spacing[2],
  },
  choiceBtn: {
    flex: 1,
    paddingVertical: Spacing[3],
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLow,
    alignItems: 'center',
  },
  choiceBtnActive: {
    backgroundColor: Colors.primaryContainer,
    borderColor: Colors.primary,
  },
  choiceText: {
    fontFamily: Fonts.scribe,
    fontSize: 14,
    color: Colors.outline,
  },
  choiceTextActive: {
    color: Colors.onPrimaryContainer,
    fontWeight: '600',
  },
  forgeButton: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    padding: Spacing[4],
    borderRadius: Radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    ...Shadow.waxSeal,
    marginTop: Spacing[4],
  },
  forgeButtonDisabled: {
    opacity: 0.6,
  },
  forgeButtonText: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    color: Colors.onPrimary,
  },
  footerPlaceholder: {
    height: 40,
  },
});
