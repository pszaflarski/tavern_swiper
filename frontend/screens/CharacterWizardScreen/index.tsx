import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, Animated, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../theme';
import StepFandom from './StepFandom';
import StepGender from './StepGender';
import StepRace from './StepRace';
import StepClass from './StepClass';
import StepResult from './StepResult';
import { styles } from './styles';

const STEPS = [
  { num: 1, label: 'Fandom' },
  { num: 2, label: 'Gender' },
  { num: 3, label: 'Race' },
  { num: 4, label: 'Class' },
  { num: 5, label: 'Result' },
];

export default function CharacterWizardScreen() {
  const [step, setStep] = useState(1);
  const [fandom, setFandom] = useState('');
  const [gender, setGender] = useState('');
  const [race, setRace] = useState('');
  const [characterClass, setCharacterClass] = useState('');

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Animate step transitions
  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [step]);

  const handleNext = () => {
    if (step < 5 && isStepValid()) {
      setStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(prev => prev - 1);
    }
  };

  const handleReset = () => {
    setFandom('');
    setGender('');
    setRace('');
    setCharacterClass('');
    setStep(1);
  };

  const handleClose = () => {
    router.back();
  };

  const isStepValid = () => {
    if (step === 1) return fandom !== ''; // Fandom is required to start
    return true; // Gender, Race, Class are optional
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {step < 5 ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <View style={styles.headerTitleRow}>
                  <Ionicons name="sparkles" size={22} color={Colors.tertiary} />
                  <Text style={styles.headerTitle}>Tavern Swiper</Text>
                </View>

              </View>
              <Pressable
                onPress={handleClose}
                style={({ pressed }) => [{
                  padding: 8,
                  borderRadius: 8,
                  backgroundColor: pressed ? Colors.surfaceContainerHigh : 'transparent',
                }]}
                accessibilityLabel="Close wizard"
                accessibilityRole="button"
                testID="wizard-close-button"
              >
                <Ionicons name="close" size={24} color={Colors.outline} />
              </Pressable>
            </View>
          </View>

          {/* Main Wizard Panel */}
          <View style={styles.glassPanel}>
            <Animated.View style={[styles.stepContent, { opacity: fadeAnim }]}>
              {step === 1 && (
                <StepFandom fandom={fandom} onSelect={setFandom} />
              )}
              {step === 2 && (
                <StepGender gender={gender} onSelect={setGender} />
              )}
              {step === 3 && (
                <StepRace fandom={fandom} race={race} onSelect={setRace} />
              )}
              {step === 4 && (
                <StepClass fandom={fandom} characterClass={characterClass} onSelect={setCharacterClass} />
              )}
            </Animated.View>

            {/* Progress Dots */}
            <View style={styles.progressDotsContainer}>
              {STEPS.map(s => (
                <View
                  key={s.num}
                  style={[
                    styles.progressDot,
                    step === s.num && styles.progressDotActive,
                    step > s.num && styles.progressDotCompleted,
                  ]}
                />
              ))}
            </View>

            {/* Navigation Controls */}
            <View style={styles.navRow}>
              <Pressable
                onPress={handleBack}
                disabled={step === 1}
                style={({ pressed }) => [
                  styles.navButton,
                  step === 1 && styles.navButtonDisabled,
                  pressed && { opacity: 0.7 },
                ]}
                testID="wizard-back-button"
              >
                <Ionicons name="arrow-back" size={16} color={Colors.outline} />
                <Text style={styles.navButtonText}>Back</Text>
              </Pressable>

              <Pressable
                onPress={handleNext}
                disabled={!isStepValid()}
                style={({ pressed }) => [
                  styles.navButton,
                  styles.navButtonPrimary,
                  !isStepValid() && styles.navButtonDisabled,
                  pressed && { opacity: 0.7 },
                ]}
                testID="wizard-next-button"
              >
                <Text style={[styles.navButtonText, styles.navButtonPrimaryText]}>Next</Text>
                <Ionicons name="arrow-forward" size={16} color={Colors.onPrimary} />
              </Pressable>
            </View>
          </View>
        </ScrollView>
      ) : (
        <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
          <StepResult
            fandom={fandom}
            gender={gender}
            race={race}
            characterClass={characterClass}
            onReset={handleReset}
            bottomInset={insets.bottom}
          />
        </Animated.View>
      )}
    </View>
  );
}
