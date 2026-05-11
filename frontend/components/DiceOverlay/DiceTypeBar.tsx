import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Fonts, Spacing, Radius } from '../../theme';
import { DICE_TYPES } from './diceConfig';

const DIE_ORDER = ['d4', 'd6', 'd8', 'd12', 'd20'];

/**
 * DiceTypeBar — horizontal row of die-type chips.
 * Appears above the input bar when the dice toggle is active.
 */
export default function DiceTypeBar({ onSelectDie }) {
  return (
    <View style={styles.container}>
      {DIE_ORDER.map(dieType => {
        const config = DICE_TYPES[dieType];
        return (
          <Pressable
            key={dieType}
            style={({ pressed }) => [
              styles.chip,
              pressed && styles.chipPressed,
            ]}
            onPress={() => onSelectDie(dieType)}
            testID={`dice-chip-${dieType}`}
          >
            <Text style={styles.chipText}>{config.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    gap: Spacing[2],
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: Colors.outlineVariant,
  },
  chip: {
    flex: 1,
    paddingVertical: Spacing[2],
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  chipPressed: {
    backgroundColor: Colors.tertiaryContainer,
    borderColor: Colors.tertiary,
  },
  chipText: {
    fontFamily: Fonts.heroic,
    fontSize: 13,
    color: Colors.tertiary,
    letterSpacing: 0.5,
  },
});
