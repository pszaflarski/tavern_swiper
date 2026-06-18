import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { CLASS_OPTIONS_BY_FANDOM } from '../../data/wizardData';
import { styles } from './styles';

interface StepClassProps {
  fandom: string;
  characterClass: string;
  onSelect: (cls: string) => void;
}

export default function StepClass({ fandom, characterClass, onSelect }: StepClassProps) {
  const options = CLASS_OPTIONS_BY_FANDOM[fandom] || CLASS_OPTIONS_BY_FANDOM['D&D'];

  return (
    <View>
      <Text style={styles.stepTitle}>
        Choose Adventuring Class{' '}
        <Text style={styles.stepOptionalTag}>(optional)</Text>
      </Text>
      <Text style={styles.stepDescription}>
        Your class defines your combat style, abilities, and role in the party.
      </Text>

      <View style={styles.optionsGrid}>
        {options.map(opt => {
          const isSelected = characterClass === opt.id;

          return (
            <View key={opt.id} style={styles.optionsGridItem}>
              <Pressable
                onPress={() => onSelect(opt.id === characterClass ? '' : opt.id)}
                style={[styles.optionCardGrid, isSelected && styles.optionCardGridSelected]}
              >
                <View style={styles.optionGridTopRow}>
                  <Text style={[styles.optionName, isSelected && styles.optionNameSelected]}>
                    {opt.name}
                  </Text>
                  <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                    {isSelected && <View style={styles.radioInner} />}
                  </View>
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
