import React, { useEffect } from 'react';
import { Platform, View, Text, Pressable, StyleSheet } from 'react-native';
import { Asset } from 'expo-asset';
import { Colors, Fonts, Spacing, Radius } from '../../theme';
import { DICE_TYPES } from './diceConfig';
import { TEXTURE_SETS } from './diceTextures';

const DIE_ORDER = ['d4', 'd6', 'd8', 'd12', 'd20'];

/**
 * DiceTypeBar — horizontal row of die-type chips.
 * Appears above the input bar when the dice toggle is active.
 */
export default function DiceTypeBar({ onSelectDie }) {
  // Preload ALL dice textures on mount so useTexture never suspends.
  // On native, downloadAsync() copies bundled assets to cache.
  // On web, this is nearly free (assets are already URL-accessible).
  useEffect(() => {
    const assets: ReturnType<typeof Asset.fromModule>[] = [];
    for (const dieType of DIE_ORDER) {
      const set = TEXTURE_SETS[dieType];
      const sides = DICE_TYPES[dieType].sides;
      for (let i = 1; i <= sides; i++) {
        assets.push(Asset.fromModule(set[i]));
      }
    }
    if (Platform.OS !== 'web') {
      Promise.all(assets.map(a => a.downloadAsync())).catch(() => {});
    }
  }, []);

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
