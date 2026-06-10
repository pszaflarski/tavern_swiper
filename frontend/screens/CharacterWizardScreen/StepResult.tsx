import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Toast from 'react-native-toast-message';
import { Colors } from '../../theme';
import { scorePresets, ScoredPreset, WizardSelections } from '../../data/wizardData';
import { profilesApi } from '../../lib/api';
import { styles } from './styles';

interface StepResultProps {
  fandom: string;
  gender: string;
  race: string;
  characterClass: string;
  onReset: () => void;
}

export default function StepResult({ fandom, gender, race, characterClass, onReset }: StepResultProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [isAdopting, setIsAdopting] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  const selections: WizardSelections = { fandom, gender, race, characterClass };
  const matches = scorePresets(selections);

  const currentMatch: ScoredPreset | null = matches[currentIndex] || null;
  const hasMultipleMatches = matches.length > 1;

  const handleNext = () => {
    setCurrentIndex(prev => (prev + 1) % matches.length);
  };

  const handlePrev = () => {
    setCurrentIndex(prev => (prev - 1 + matches.length) % matches.length);
  };

  // Build the profile creation payload
  const buildPayload = () => {
    if (!currentMatch) return null;
    const { preset } = currentMatch;

    // Tag validation is skipped for generated profiles on the backend,
    // so we can attach wizard-assigned tags directly.
    const payload: any = {
      display_name: preset.name,
      tagline: preset.tagline,
      bio: preset.bio,
      is_oc: false,
      generated: true,
    };

    if (fandom) {
      const fandomName = fandom === 'D&D' ? 'Forgotten Realms (D&D)' : fandom;
      payload.fandom = [{ id: `wiz-fandom-${fandom.toLowerCase().replace(/&/g, 'n')}`, category: 'fandom', name: fandomName, slug: `fandom__${fandom.toLowerCase().replace(/&/g, 'n').replace(/\s+/g, '_')}` }];
    }
    if (preset.gender) {
      payload.gender = [{ id: `wiz-gender-${preset.gender.toLowerCase()}`, category: 'gender', name: preset.gender, slug: `gender__${preset.gender.toLowerCase()}` }];
    }
    if (preset.race) {
      payload.race = [{ id: `wiz-race-${preset.race.toLowerCase()}`, category: 'race', name: preset.race, slug: `race__${preset.race.toLowerCase().replace(/\s+/g, '_')}` }];
    }
    if (preset.class) {
      payload.other_tags = {
        class: [{ id: `wiz-class-${preset.class.toLowerCase()}`, category: 'class', name: preset.class, slug: `class__${preset.class.toLowerCase().replace(/\s+/g, '_')}` }],
      };
    }

    return payload;
  };

  const handleAdopt = async () => {
    const payload = buildPayload();
    if (!payload) return;

    setIsAdopting(true);
    try {
      await profilesApi.post('/profiles/', payload);
      // Refresh profiles cache so routing guard sees the new generated profile
      await queryClient.refetchQueries({ queryKey: ['profiles'] });
      Toast.show({
        type: 'success',
        text1: '⚔️ Hero Adopted!',
        text2: `${currentMatch!.preset.name} has joined your party.`,
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

  if (!currentMatch) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>🍺</Text>
        <Text style={styles.emptyTitle}>Tavern Empty</Text>
        <Text style={styles.emptyDesc}>
          No adventurers match these criteria, and even the backup portal failed.
        </Text>
        <Pressable style={styles.resetButton} onPress={onReset}>
          <Text style={styles.resetButtonText}>Reset Wizard</Text>
        </Pressable>
      </View>
    );
  }

  const { preset, score } = currentMatch;
  const isExactMatch = score === 7;

  return (
    <ScrollView contentContainerStyle={styles.resultContainer} showsVerticalScrollIndicator={false}>
      {/* Title */}
      <Text style={styles.stepTitle}>Adventurer Summoned!</Text>
      <Text style={styles.resultSubtitle}>
        {isExactMatch
          ? '🎯 Found an exact match in the tavern archives!'
          : '🍻 No exact match found. Showing the closest matching heroes!'}
      </Text>

      {/* Character Card */}
      <View style={{ position: 'relative' }}>
        <View style={styles.characterCard}>
          {/* Image placeholder area */}
          <View style={styles.characterImageArea}>
            <Text style={styles.characterImagePlaceholder}>⚔️</Text>
          </View>

          {/* Card body */}
          <View style={styles.characterCardBody}>
            {/* Tag badges */}
            <View style={styles.badgeRow}>
              <View style={[styles.badge, styles.badgeFandom]}>
                <Text style={styles.badgeText}>{fandom}</Text>
              </View>
              <View style={[styles.badge, styles.badgeRace]}>
                <Text style={styles.badgeText}>{preset.race}</Text>
              </View>
              <View style={[styles.badge, styles.badgeGender]}>
                <Text style={styles.badgeText}>{preset.gender}</Text>
              </View>
            </View>

            <Text style={styles.characterClass}>{preset.class}</Text>
            <Text style={styles.characterName}>{preset.name}</Text>
            <Text style={styles.characterTagline}>"{preset.tagline}"</Text>
            <Text style={styles.characterBio} numberOfLines={4}>{preset.bio}</Text>
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
