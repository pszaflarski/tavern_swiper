import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
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
          tabBarButton: (props: any) => (
            <TouchableOpacity {...props} testID="tab-bar-tavern" />
          ),
        }}
      />
      <Tabs.Screen
        name="profiles"
        options={{
          title: 'Profiles',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons 
              name={focused ? 'people' : 'people-outline'} 
              size={24} 
              color={color} 
            />
          ),
          tabBarButton: (props: any) => (
            <TouchableOpacity {...props} testID="tab-bar-profiles" />
          ),
        }}
      />
    </Tabs>
  );
}
