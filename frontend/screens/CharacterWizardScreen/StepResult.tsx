import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { Colors } from '../../theme';
import { charactersApi, profilesApi } from '../../lib/api';
import { styles } from './styles';

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
  images: CharacterImage[];
}

interface StepResultProps {
  fandom: string;
  gender: string;
  race: string;
  characterClass: string;
  onReset: () => void;
}

/** Score a character against wizard selections — higher = better match. */
function scoreCharacter(char: Character, fandom: string, gender: string, race: string): number {
  let score = 0;
  if (fandom && char.fandom?.some(t => t.name === fandom)) score += 3;
  if (gender && char.gender?.some(t => t.name === gender)) score += 2;
  if (race && char.race?.some(t => t.name === race)) score += 2;
  return score;
}

export default function StepResult({ fandom, gender, race, characterClass, onReset }: StepResultProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [isAdopting, setIsAdopting] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Fetch all characters from the characters service
  const { data: characters, isLoading: isLoadingChars, isError } = useQuery<Character[]>({
    queryKey: ['wizard', 'characters'],
    queryFn: async () => {
      const res = await charactersApi.get('/characters/');
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // cache for 5 min
  });

  // Score and sort characters by match quality
  const matches = React.useMemo(() => {
    if (!characters) return [];
    return characters
      .map(char => ({ char, score: scoreCharacter(char, fandom, gender, race) }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [characters, fandom, gender, race]);

  const currentMatch = matches[currentIndex] || null;
  const hasMultipleMatches = matches.length > 1;

  const handleNext = () => setCurrentIndex(prev => (prev + 1) % matches.length);
  const handlePrev = () => setCurrentIndex(prev => (prev - 1 + matches.length) % matches.length);

  // Build the profile creation payload from the real character data
  const buildPayload = () => {
    if (!currentMatch) return null;
    const { char } = currentMatch;

    const payload: any = {
      display_name: char.display_name,
      tagline: char.tagline,
      bio: char.bio,
      is_oc: false,
      generated: true,
    };

    // Use actual image URLs from the character
    if (char.images?.length > 0) {
      payload.image_urls = char.images.map(img => img.url);
    }

    // Use real tags from the characters service
    if (char.fandom?.length > 0) payload.fandom = char.fandom;
    if (char.gender?.length > 0) payload.gender = char.gender;
    if (char.race?.length > 0) payload.race = char.race;

    return payload;
  };

  const handleAdopt = async () => {
    const payload = buildPayload();
    if (!payload) return;

    setIsAdopting(true);
    try {
      await profilesApi.post('/profiles/', payload);
      await queryClient.refetchQueries({ queryKey: ['profiles'] });
      Toast.show({
        type: 'success',
        text1: '⚔️ Hero Adopted!',
        text2: `${currentMatch!.char.display_name} has joined your party.`,
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

  const generatedPayload = buildPayload();

  // Loading state
  if (isLoadingChars) {
    return (
      <View style={styles.emptyContainer}>
        <ActivityIndicator size="large" color={Colors.tertiary} />
        <Text style={styles.emptyTitle}>Searching the Tavern...</Text>
        <Text style={styles.emptyDesc}>Looking for adventurers that match your criteria.</Text>
      </View>
    );
  }

  // Error / no matches
  if (isError || !currentMatch) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>🍺</Text>
        <Text style={styles.emptyTitle}>Tavern Empty</Text>
        <Text style={styles.emptyDesc}>
          No adventurers match these criteria. Try different selections!
        </Text>
        <Pressable style={styles.resetButton} onPress={onReset}>
          <Text style={styles.resetButtonText}>Reset Wizard</Text>
        </Pressable>
      </View>
    );
  }

  const { char, score } = currentMatch;
  const maxScore = 7;
  const isExactMatch = score === maxScore;
  const imageUrl = char.images?.[0]?.url;

  // Extract tag names for display
  const raceName = char.race?.[0]?.name || race;
  const genderName = char.gender?.[0]?.name || gender;
  const fandomName = char.fandom?.[0]?.name || fandom;

  return (
    <ScrollView contentContainerStyle={styles.resultContainer} showsVerticalScrollIndicator={false}>
      {/* Title */}
      <Text style={styles.stepTitle}>Adventurer Summoned!</Text>
      <Text style={styles.resultSubtitle}>
        {isExactMatch
          ? '🎯 Found an exact match in the tavern archives!'
          : '🍻 Showing the closest matching heroes from the tavern!'}
      </Text>

      {/* Character Card */}
      <View style={{ position: 'relative' }}>
        <View style={styles.characterCard}>
          {/* Character image */}
          <View style={styles.characterImageArea}>
            {imageUrl ? (
              <Image
                source={{ uri: imageUrl }}
                style={{ width: '100%', height: '100%', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.characterImagePlaceholder}>⚔️</Text>
            )}
          </View>

          {/* Card body */}
          <View style={styles.characterCardBody}>
            {/* Tag badges */}
            <View style={styles.badgeRow}>
              <View style={[styles.badge, styles.badgeFandom]}>
                <Text style={styles.badgeText}>{fandomName}</Text>
              </View>
              <View style={[styles.badge, styles.badgeRace]}>
                <Text style={styles.badgeText}>{raceName}</Text>
              </View>
              <View style={[styles.badge, styles.badgeGender]}>
                <Text style={styles.badgeText}>{genderName}</Text>
              </View>
            </View>

            <Text style={styles.characterName}>{char.display_name}</Text>
            <Text style={styles.characterTagline}>"{char.tagline}"</Text>
            <Text style={styles.characterBio} numberOfLines={4}>{char.bio}</Text>
          </View>
        </View>

        {/* Carousel navigation arrows */}
        {hasMultipleMatches && (
          <>
            <Pressable
              style={[styles.carouselNavButton, styles.carouselNavLeft]}
              onPress={handlePrev}
            >
              <Ionicons name="chevron-back" size={18} color={Colors.onSurface} />
            </Pressable>
            <Pressable
              style={[styles.carouselNavButton, styles.carouselNavRight]}
              onPress={handleNext}
            >
              <Ionicons name="chevron-forward" size={18} color={Colors.onSurface} />
            </Pressable>
          </>
        )}
      </View>

      {/* Match counter */}
      {hasMultipleMatches && (
        <View style={styles.matchCounter}>
          <Ionicons name="sparkles" size={14} color={Colors.tertiary} />
          <Text style={styles.matchCounterText}>
            Adventurer {currentIndex + 1} of {matches.length} matching
          </Text>
        </View>
      )}

      {/* Action buttons */}
      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed && { opacity: 0.7 }]}
          onPress={onReset}
        >
          <Ionicons name="arrow-back" size={14} color={Colors.outline} />
          <Text style={styles.actionButtonText}>Back to Start</Text>
        </Pressable>

        {hasMultipleMatches && (
          <Pressable
            style={({ pressed }) => [styles.actionButton, styles.actionButtonGold, pressed && { opacity: 0.7 }]}
            onPress={handleNext}
          >
            <Ionicons name="refresh" size={14} color={Colors.onTertiaryContainer} />
            <Text style={[styles.actionButtonText, styles.actionButtonTextGold]}>Next Match</Text>
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [styles.actionButton, styles.actionButtonPrimary, pressed && { opacity: 0.7 }]}
          onPress={handleAdopt}
          disabled={isAdopting}
        >
          <Ionicons name="shield-checkmark" size={14} color={Colors.onPrimary} />
          <Text style={[styles.actionButtonText, styles.actionButtonTextPrimary]}>
            {isAdopting ? 'Summoning...' : 'Adopt This Hero'}
          </Text>
        </Pressable>
      </View>

      {/* JSON Inspector (collapsible) */}
      <View style={styles.inspectorContainer}>
        <Pressable
          style={styles.inspectorHeader}
          onPress={() => setInspectorOpen(!inspectorOpen)}
        >
          <Ionicons
            name={inspectorOpen ? 'chevron-down' : 'chevron-forward'}
            size={12}
            color={Colors.outline}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.inspectorHeaderText}>Inspect Database Payload JSON</Text>
        </Pressable>
        {inspectorOpen && (
          <View style={styles.inspectorBody}>
            <Text style={styles.inspectorCode}>
              {JSON.stringify(generatedPayload, null, 2)}
            </Text>
          </View>
        )}
      </View>

      {/* Adopting overlay */}
      {isAdopting && (
        <View style={styles.adoptingOverlay}>
          <ActivityIndicator size="large" color={Colors.tertiary} />
          <Text style={styles.adoptingText}>Summoning Hero...</Text>
        </View>
      )}
    </ScrollView>
  );
}
