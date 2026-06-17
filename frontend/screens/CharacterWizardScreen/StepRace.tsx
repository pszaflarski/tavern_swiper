import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { RACE_OPTIONS_BY_FANDOM } from '../../data/wizardData';
import { styles } from './styles';

interface StepRaceProps {
  fandom: string;
  race: string;
  onSelect: (race: string) => void;
}

export default function StepRace({ fandom, race, onSelect }: StepRaceProps) {
  const options = RACE_OPTIONS_BY_FANDOM[fandom] || RACE_OPTIONS_BY_FANDOM['D&D'];

  return (
    <View>
      <Text style={styles.stepTitle}>
        Select Fantasy Race{' '}
        <Text style={styles.stepOptionalTag}>(optional)</Text>
      </Text>
      <Text style={styles.stepDescription}>
        Your race shapes your character's lore, appearance, and stat affinities.
      </Text>

      <View style={styles.optionsGrid}>
        {options.map(opt => {
          const isSelected = race === opt.id;

          return (
            <View key={opt.id} style={styles.optionsGridItem}>
              <Pressable
                onPress={() => onSelect(opt.id === race ? '' : opt.id)}
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
