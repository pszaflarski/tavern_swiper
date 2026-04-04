import React from 'react';
import { Tabs, Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import BottomNav, { TabName } from '../../components/BottomNav';
import { Colors } from '../../theme';
import { useUser } from '../../hooks/useUser';

export default function TabsLayout() {
  const { isAuthenticated, isLoading, authInitialized } = useUser();

  if (isLoading || !authInitialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    console.log('[TABS DEBUG] Not authenticated, redirecting to /auth');
    return <Redirect href="/auth" />;
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
