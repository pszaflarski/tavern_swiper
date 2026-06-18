import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme';
import { FANDOM_OPTIONS } from '../../data/wizardData';
import { styles } from './styles';

interface StepFandomProps {
  fandom: string;
  onSelect: (fandom: string) => void;
}

export default function StepFandom({ fandom, onSelect }: StepFandomProps) {
  return (
    <View>
      <Text style={styles.stepTitle}>Select Fandom Universe</Text>
      <Text style={styles.stepDescription}>
        Aligning with a fandom unlocks specific layout shapes and archetype filters.
      </Text>

      <View style={styles.optionsList}>
        {FANDOM_OPTIONS.map(opt => {
          const isSelected = fandom === opt.id;

          if (opt.active === false) {
            return (
              <View key={opt.id} style={[styles.optionCard, styles.optionCardLocked]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Text style={styles.optionName}>{opt.name}</Text>
                  <View style={styles.lockBadge}>
                    <Ionicons name="lock-closed" size={10} color={Colors.outline} />
                    <Text style={styles.lockBadgeText}>Coming Soon</Text>
                  </View>
                </View>
                <View style={styles.radioOuter}>
                  <Ionicons name="compass-outline" size={12} color={Colors.outline} />
                </View>
              </View>
            );
          }

          return (
            <Pressable
              key={opt.id}
              onPress={() => onSelect(opt.id)}
              style={[styles.optionCard, isSelected && styles.optionCardSelected]}
            >
              <View style={styles.optionInfoContainer}>
                <Text style={[styles.optionName, isSelected && styles.optionNameSelected]}>
                  {opt.name}
                </Text>
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
