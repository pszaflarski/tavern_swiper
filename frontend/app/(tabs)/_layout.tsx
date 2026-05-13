import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts } from '../../theme';
import { useUnreadStatus } from '../../hooks/useUnreadStatus';

export default function TabLayout() {
  const { hasAnyUnread } = useUnreadStatus();

  return (
    <Tabs
      {...{ sceneContainerStyle: { backgroundColor: Colors.background } } as any}
      screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.outline,
        tabBarStyle: {
          backgroundColor: Colors.surfaceContainerLowest,
          borderTopColor: Colors.outlineVariant,
        },
        headerShown: false,
        tabBarHideOnKeyboard: true,
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
          tabBarButtonTestID: 'tab-bar-tavern',
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
          tabBarButtonTestID: 'tab-bar-profiles',
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color, focused }) => (
            <View>
              <Ionicons 
                name={focused ? 'chatbubble' : 'chatbubble-outline'} 
                size={24} 
                color={color} 
              />
              {hasAnyUnread && (
                <View style={{
                  position: 'absolute',
                  top: -2,
                  right: -4,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: Colors.error,
                }} />
              )}
            </View>
          ),
          tabBarButtonTestID: 'tab-bar-messages',
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons 
              name={focused ? 'person-circle' : 'person-circle-outline'} 
              size={24} 
              color={color} 
            />
          ),
          tabBarButtonTestID: 'tab-bar-account',
        }}
      />
    </Tabs>
  );
}
