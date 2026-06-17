import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { GENDER_OPTIONS } from '../../data/wizardData';
import { styles } from './styles';

interface StepGenderProps {
  gender: string;
  onSelect: (gender: string) => void;
}

export default function StepGender({ gender, onSelect }: StepGenderProps) {
  return (
    <View>
      <Text style={styles.stepTitle}>
        Choose Gender Identity{' '}
        <Text style={styles.stepOptionalTag}>(optional)</Text>
      </Text>
      <Text style={styles.stepDescription}>
        This shapes your character's appearance and archetype suggestions.
      </Text>

      <View style={styles.optionsList}>
        {GENDER_OPTIONS.map(opt => {
          const isSelected = gender === opt.id;

          return (
            <Pressable
              key={opt.id}
              onPress={() => onSelect(opt.id === gender ? '' : opt.id)}
              style={[styles.optionCard, isSelected && styles.optionCardSelected]}
            >
              <View style={styles.optionInfoContainer}>
                <Text style={[styles.optionName, isSelected && styles.optionNameSelected]}>
                  {opt.name}
                </Text>
                {opt.desc ? <Text style={styles.optionDesc}>{opt.desc}</Text> : null}
              </View>
              <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                {isSelected && <View style={styles.radioInner} />}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
