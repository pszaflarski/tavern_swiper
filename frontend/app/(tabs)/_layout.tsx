import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import BottomNav, { TabName } from '../../components/BottomNav';
import { Colors } from '../../theme';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => (
        <BottomNav
          activeTab={props.state.routes[props.state.index].name as TabName}
          onTabPress={(name) => props.navigation.navigate(name)}
        />
      )}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Tavern' }} />
      <Tabs.Screen name="scrolls" options={{ title: 'Scrolls' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
