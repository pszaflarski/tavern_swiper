import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { View, Text, Pressable, ActivityIndicator, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { Colors, Fonts } from '../../theme';
import { charactersApi, profilesApi } from '../../lib/api';
import { useUser } from '../../hooks/useUser';
import { Profile } from '../../types';
import { styles } from './styles';
import DiceLoadingScreen from '../../components/DiceLoadingScreen';

interface CharacterImage {
  image_id: string;
  url: string;
  source_type: string;
  position: number;
}

interface CharTag {
  id: string;
  category: string;
  name: string;
  slug: string;
}

interface Character {
  character_id: string;
  display_name: string;
  tagline: string;
  bio: string;
  fandom: CharTag[];
  race: CharTag[];
  gender: CharTag[];
  class: CharTag[];
  images: CharacterImage[];
  status: string;
}

interface StepResultProps {
  fandom: string;
  gender: string;
  race: string;
  characterClass: string;
  onReset: () => void;
}

function toCharTag(tag: any): CharTag {
  return {
    id: tag.id,
    category: tag.category,
    name: tag.name,
    slug: tag.slug,
  };
}

export default function StepResult({ fandom, gender, race, characterClass, onReset }: StepResultProps) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [loadingState, setLoadingState] = useState<'resolving_tags' | 'generating_details' | 'generating_image' | 'ready' | 'error' | 'image_failed'>('resolving_tags');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isAdopting, setIsAdopting] = useState(false);

  const router = useRouter();
  const queryClient = useQueryClient();
  const { uid } = useUser();
  const isMounted = useRef(true);

  const generateProfile = async () => {
    try {
      setLoadingState('resolving_tags');
      setErrorMsg(null);
      setCharacter(null);

      // Fetch all tags in the 4 categories from characters service
      const [fandoms, genders, races, classes] = await Promise.all([
        charactersApi.get('/characters/tags/by-category/fandom').then(r => r.data).catch(() => []),
        charactersApi.get('/characters/tags/by-category/gender').then(r => r.data).catch(() => []),
        charactersApi.get('/characters/tags/by-category/race').then(r => r.data).catch(() => []),
        charactersApi.get('/characters/tags/by-category/class').then(r => r.data).catch(() => []),
      ]);

      if (!isMounted.current) return;

      // Resolve our selection strings to full CharTag objects
      const fandomTag = fandoms.find((t: any) => t.name.toLowerCase() === fandom.toLowerCase());
      const genderTag = genders.find((t: any) => t.name.toLowerCase() === gender.toLowerCase());
      const raceTag = races.find((t: any) => t.name.toLowerCase() === race.toLowerCase());
      const classTag = classes.find((t: any) => t.name.toLowerCase() === characterClass.toLowerCase());

      if (!fandomTag) {
        throw new Error(`Could not resolve fandom tag: "${fandom}"`);
      }

      const resolvedTags = {
        fandom: [toCharTag(fandomTag)],
        gender: genderTag ? [toCharTag(genderTag)] : [],
        race: raceTag ? [toCharTag(raceTag)] : [],
        class: classTag ? [toCharTag(classTag)] : [],
      };

      setLoadingState('generating_details');
      
      // POST to /characters/generate to create character with AI details
      const genRes = await charactersApi.post('/characters/generate', resolvedTags, { timeout: 30000 });
      if (!isMounted.current) return;

      const generatedChar = genRes.data;
      setCharacter(generatedChar);

      // Start background image generation
      setLoadingState('generating_image');
      try {
        const imgRes = await charactersApi.post(`/characters/${generatedChar.character_id}/generate-image`);
        if (!isMounted.current) return;
        setCharacter(imgRes.data);
        setLoadingState('ready');
      } catch (imgErr: any) {
        console.error('[Wizard] Image generation failed:', imgErr?.response?.data || imgErr.message);
        if (!isMounted.current) return;
        setLoadingState('image_failed');
      }
    } catch (err: any) {
      console.error('[Wizard] Details generation failed:', err?.response?.data || err.message);
      if (!isMounted.current) return;
      setErrorMsg(err?.response?.data?.detail || err.message || 'Could not brew details.');
      setLoadingState('error');
    }
  };

  useEffect(() => {
    isMounted.current = true;
    generateProfile();
    return () => {
      isMounted.current = false;
    };
  }, [fandom, gender, race, characterClass]);

  const handleRegenerateImage = async () => {
    if (!character) return;
    setLoadingState('generating_image');
    // Clear old images array so the shimmers render nicely
    setCharacter(prev => prev ? { ...prev, images: [] } : null);
    try {
      const imgRes = await charactersApi.post(`/characters/${character.character_id}/generate-image`);
      if (!isMounted.current) return;
      setCharacter(imgRes.data);
      setLoadingState('ready');
    } catch (imgErr: any) {
      console.error('[Wizard] Image generation retry failed:', imgErr?.response?.data || imgErr.message);
      if (!isMounted.current) return;
      setLoadingState('image_failed');
      Toast.show({
        type: 'error',
        text1: 'Portrait Forging Failed',
        text2: imgErr?.response?.data?.detail || imgErr.message || 'Retry failed.',
      });
    }
  };

  const handleAdopt = async () => {
    if (!character) return;

    setIsAdopting(true);
    try {
      // Step 1: Adopt in characters service to toggle status to "adopted"
      await charactersApi.post(`/characters/${character.character_id}/adopt`);

      // Step 2: Create profile in profiles service
      const payload = {
        display_name: character.display_name,
        tagline: character.tagline,
        bio: character.bio,
        is_oc: false,
        generated: true,
        image_urls: character.images?.map((img: any) => img.url) || [],
        fandom: character.fandom || [],
        gender: character.gender || [],
        race: character.race || [],
      };

      const res = await profilesApi.post('/profiles/', payload);
      const newProfile = res.data;

      // Update the cache immediately to prevent navigation race conditions
      if (uid) {
        queryClient.setQueryData(['profiles', 'user', uid], (old: Profile[] | undefined) => {
          if (!old) return [newProfile];
          if (old.some(p => p.profile_id === newProfile.profile_id)) return old;
          return [...old, newProfile];
        });
        queryClient.setQueryData(['profiles', 'me', 'active', uid], newProfile);
      }

      await queryClient.refetchQueries({ queryKey: ['profiles'] });

      Toast.show({
        type: 'success',
        text1: '⚔️ Hero Adopted!',
        text2: `${character.display_name} has joined your party.`,
      });
      router.replace('/(tabs)/profiles');
    } catch (error: any) {
      console.error('[Wizard] Adopt failed:', error?.response?.data || error.message);
      Toast.show({
        type: 'error',
        text1: 'Summoning Failed',
        text2: error?.response?.data?.detail || error.message || 'Could not adopt this hero.',
      });
    } finally {
      setIsAdopting(false);
    }
  };

  // Tag resolving & details generation loaders
  if (loadingState === 'resolving_tags' || loadingState === 'generating_details') {
    const statusTitle = loadingState === 'resolving_tags' 
      ? 'Resolving Tavern Tags...' 
      : 'Brewing Character Details...';
    return <DiceLoadingScreen message={statusTitle} />;
  }

  // Error / no character details generated
  if (loadingState === 'error' || !character) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>🍺</Text>
        <Text style={styles.emptyTitle}>Tavern Empty</Text>
        <Text style={styles.emptyDesc}>
          {errorMsg || 'No adventurers match these criteria. Try different selections!'}
        </Text>
        <Pressable style={styles.resetButton} onPress={onReset}>
          <Text style={styles.resetButtonText}>Reset Wizard</Text>
        </Pressable>
      </View>
    );
  }

  // Active character details display (with background image or loaders)
  const imageUrl = character.images?.[0]?.url;
  const raceName = character.race?.[0]?.name || race;
  const genderName = character.gender?.[0]?.name || gender;
  const fandomName = character.fandom?.[0]?.name || fandom;
  const className = character.class?.[0]?.name || characterClass;

  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      {/* Full-screen background image / loader */}
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.characterImageArea]}>
          {loadingState === 'generating_image' ? (
            <DiceLoadingScreen
              containerStyle={{ backgroundColor: 'transparent' }}
              canvasSize={180}
            />
          ) : loadingState === 'image_failed' ? (
            <View style={{ alignItems: 'center', gap: 12, paddingHorizontal: 32 }}>
              <Ionicons name="image-outline" size={48} color={Colors.outline} />
              <Text style={{ fontFamily: Fonts.heroic, color: Colors.outline, fontSize: 16, textAlign: 'center' }}>
                Portrait Forging Failed
              </Text>
              <Pressable
                onPress={handleRegenerateImage}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: 4,
                  backgroundColor: Colors.tertiaryContainer,
                  borderWidth: 1,
                  borderColor: Colors.tertiary,
                }}
              >
                <Text style={{ fontFamily: Fonts.heroic, color: Colors.onTertiaryContainer, fontSize: 12 }}>
                  Retry Forging
                </Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.characterImagePlaceholder}>⚔️</Text>
          )}
        </View>
      )}

      {/* Dark gradient overlay at bottom for text readability */}
      <View style={[styles.characterGradient, { backgroundColor: 'transparent' }]}>
        <View style={{ flex: 1, background: 'linear-gradient(transparent, rgba(0,0,0,0.85))' } as any} />
      </View>

      {/* Hero info overlaid at bottom of image, above buttons */}
      <View style={styles.characterCardBody}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, styles.badgeFandom]}>
            <Text style={styles.badgeText}>{fandomName}</Text>
          </View>
          {raceName ? (
            <View style={[styles.badge, styles.badgeRace]}>
              <Text style={styles.badgeText}>{raceName}</Text>
            </View>
          ) : null}
          {genderName ? (
            <View style={[styles.badge, styles.badgeGender]}>
              <Text style={styles.badgeText}>{genderName}</Text>
            </View>
          ) : null}
          {className ? (
            <View style={[styles.badge]}>
              <Text style={styles.badgeText}>{className}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.characterName}>{character.display_name}</Text>
        {character.tagline ? <Text style={styles.characterTagline}>"{character.tagline}"</Text> : null}
        {character.bio ? <Text style={styles.characterBio} numberOfLines={4}>{character.bio}</Text> : null}
      </View>

      {/* Action buttons — fixed at bottom */}
      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.7 }]}
          onPress={onReset}
          disabled={isAdopting}
        >
          <Ionicons name="arrow-back" size={14} color={Colors.outline} />
          <Text style={styles.actionButtonText}>Back to Start</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            (loadingState === 'resolving_tags' || loadingState === 'generating_details' || isAdopting) && styles.navButtonDisabled,
            pressed && { opacity: 0.7 }
          ]}
          onPress={generateProfile}
          disabled={loadingState === 'resolving_tags' || loadingState === 'generating_details' || isAdopting}
        >
          <Ionicons name="refresh" size={14} color={Colors.outline} />
          <Text style={styles.actionButtonText}>Next Profile</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            (loadingState === 'resolving_tags' || loadingState === 'generating_details' || loadingState === 'generating_image' || isAdopting) && styles.navButtonDisabled,
            pressed && { opacity: 0.7 }
          ]}
          onPress={handleRegenerateImage}
          disabled={loadingState === 'resolving_tags' || loadingState === 'generating_details' || loadingState === 'generating_image' || isAdopting}
        >
          <Ionicons name="image" size={14} color={Colors.outline} />
          <Text style={styles.actionButtonText}>New Portrait</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            styles.actionButtonPrimary,
            (loadingState === 'generating_image' || isAdopting) && styles.navButtonDisabled,
            pressed && { opacity: 0.7 }
          ]}
          onPress={handleAdopt}
          disabled={loadingState === 'generating_image' || isAdopting}
        >
          <Ionicons name="shield-checkmark" size={14} color={Colors.onPrimary} />
          <Text style={[styles.actionButtonText, styles.actionButtonTextPrimary]}>
            {isAdopting ? 'Summoning...' : 'Adopt This Hero'}
          </Text>
        </Pressable>
      </View>

      {/* Adopting overlay */}
      {isAdopting && (
        <View style={StyleSheet.absoluteFillObject}>
          <DiceLoadingScreen message="Summoning Hero..." />
        </View>
      )}
    </View>
  );
}

