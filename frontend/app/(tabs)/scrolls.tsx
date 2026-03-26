import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../theme';

export default function ScrollsScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Quest Log</Text>
        <Text style={styles.headerSub}>Your magical connections</Text>
      </View>
      <View style={styles.centered}>
        <Text style={styles.icon}>📜</Text>
        <Text style={styles.emptyTitle}>The scrolls are empty...</Text>
        <Text style={styles.emptySubtitle}>Start swiping in the Tavern to find fellow heroes.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  header: {
    paddingTop: Spacing[16],
    paddingBottom: Spacing[4],
    paddingHorizontal: Spacing[6],
    backgroundColor: Colors.surfaceContainerLowest,
  },
  headerTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 24,
    fontWeight: '700',
    color: Colors.primary,
  },
  headerSub: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.outline,
    textTransform: 'uppercase',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[10],
    gap: Spacing[3],
  },
  icon: {
    fontSize: 64,
  },
  emptyTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 20,
    color: Colors.onSurface,
  },
  emptySubtitle: {
    fontFamily: Fonts.scribe,
    fontSize: 15,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
  },
});
