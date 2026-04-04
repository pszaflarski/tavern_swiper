import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Fonts, Radius, Spacing, Shadow } from '../theme';

export type TabName = 'index' | 'scrolls' | 'profiles';

interface NavTab {
  name: TabName;
  label: string;
  icon: string;
}

const TABS: NavTab[] = [
  { name: 'index', label: 'Tavern', icon: '🏰' },
  { name: 'scrolls', label: 'Scrolls', icon: '📜' },
  { name: 'profiles', label: 'Profiles', icon: '🛡️' },
];

interface BottomNavProps {
  activeTab: TabName;
  onTabPress: (tab: TabName) => void;
}

export default function BottomNav({ activeTab, onTabPress }: BottomNavProps) {
  return (
    <View style={styles.container} testID="bottom-nav">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.name;
        return (
          <TouchableOpacity
            key={tab.name}
            style={styles.tab}
            onPress={() => onTabPress(tab.name)}
            activeOpacity={0.7}
          >
            <Text style={styles.icon}>{tab.icon}</Text>
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {tab.label}
            </Text>
            {isActive && <View style={styles.activeIndicator} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceContainerLowest,
    // Glassmorphism footer bar
    borderTopWidth: 0,
    paddingBottom: Spacing[4],
    paddingTop: Spacing[3],
    paddingHorizontal: Spacing[5],
    ...Shadow.waxSeal,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[1],
    position: 'relative',
  },
  icon: {
    fontSize: 22,
  },
  label: {
    fontFamily: Fonts.scribe,
    fontSize: 11,
    color: Colors.outline,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  labelActive: {
    color: Colors.primary,
    fontWeight: '600',
  },
  activeIndicator: {
    position: 'absolute',
    bottom: -Spacing[3],
    width: 24,
    height: 3,
    backgroundColor: Colors.tertiary,
    borderRadius: Radius.full,
  },
});
