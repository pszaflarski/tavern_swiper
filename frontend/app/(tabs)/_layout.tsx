import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import BottomNav, { TabName } from '../../components/BottomNav';
import { Colors } from '../../theme';

import { useUser } from '../../hooks/useUser';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

export default function TabsLayout() {
  const { isAuthenticated, isLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/auth');
    }
  }, [isLoading, isAuthenticated]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

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
      <Tabs.Screen name="profiles" options={{ title: 'Profiles' }} />
    </Tabs>
  );
}
