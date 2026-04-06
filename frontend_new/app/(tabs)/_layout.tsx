import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.outline,
        tabBarStyle: {
          backgroundColor: Colors.surfaceContainerLowest,
          borderTopColor: Colors.outlineVariant,
        },
        headerShown: false,
        tabBarLabelStyle: {
          fontFamily: Fonts.scribe,
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: 1,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Tavern',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons 
              name={focused ? 'beer' : 'beer-outline'} 
              size={24} 
              color={color} 
            />
          ),
        }}
      />
    </Tabs>
  );
}
