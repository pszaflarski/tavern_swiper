import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Fonts, Spacing } from '../theme';

interface ScreenHeaderProps {
  title: string;
  isAbsolute?: boolean;
}

export default function ScreenHeader({ title, isAbsolute }: ScreenHeaderProps) {
  return (
    <View style={[
      styles.header, 
      isAbsolute && styles.absoluteHeader
    ]}>
      <Text style={styles.headerTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: Spacing[6],
    paddingBottom: Spacing[2],
    paddingHorizontal: Spacing[6],
    backgroundColor: Colors.surfaceContainerLowest,
    alignItems: 'center',
    zIndex: 10,
  },
  absoluteHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(13, 17, 15, 0.7)',
  },
  headerTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 1,
  },
});
