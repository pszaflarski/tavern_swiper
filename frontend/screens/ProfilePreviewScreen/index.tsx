import React, { useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, useWindowDimensions } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, Fonts } from '../../theme';
import { useProfile } from '../../hooks/useProfiles';
import { Ionicons } from '@expo/vector-icons';
import { SwipeCard, SwipeProfile } from '../../components/SwipeDeck';
import { styles } from './styles';

export default function ProfilePreviewScreen() {
  const { id, previewData } = useLocalSearchParams<{ id?: string, previewData?: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();

  // If previewData is provided (from the form), parse it. Otherwise, fetch by ID.
  const parsedPreviewData: SwipeProfile | null = previewData ? JSON.parse(previewData) : null;
  const { data: fetchedProfile, isLoading } = useProfile(parsedPreviewData ? undefined : id);

  const profile: SwipeProfile | null = parsedPreviewData || (fetchedProfile as SwipeProfile | null);
  
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleDismiss = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profiles' as any);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Summoning the vision...</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
        <Text style={styles.errorText}>The vision is clouded. Profile not found.</Text>
        <Pressable onPress={handleDismiss} style={{ marginTop: 20 }}>
          <Text style={{ color: Colors.primary, fontFamily: Fonts.scribe }}>Return</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="profile-preview-screen">
      <Stack.Screen
        options={{
          title: 'Hero Vision',
          headerShown: true,
          headerStyle: { backgroundColor: Colors.surfaceContainerLowest },
          headerTitleStyle: { fontFamily: Fonts.heroic, color: Colors.onSurface },
          headerTintColor: Colors.primary,
          headerLeft: () => (
            <Pressable 
              onPress={handleDismiss} 
              style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.7 }]}
              testID="preview-header-close-button"
            >
              <Ionicons name="close" size={24} color={Colors.outline} />
            </Pressable>
          ),
        }}
      />
      
      <View style={styles.cardContainer}>
        <SwipeCard
          profile={profile}
          isTop={true}
          index={0}
          currentIndex={currentIndex}
          onIndexChange={setCurrentIndex}
          onSwipeLeft={handleDismiss}
          onSwipeRight={handleDismiss}
          cardWidth={width * 0.95}
        />
        
        {/* Indicators overlay for the preview */}
        {profile.image_urls && profile.image_urls.length > 1 && (
          <View style={styles.indicatorContainer} pointerEvents="none">
            {profile.image_urls.map((_, i) => (
              <View 
                key={i} 
                style={[
                  styles.indicator, 
                  { 
                    backgroundColor: i === currentIndex 
                      ? Colors.tertiary 
                      : 'rgba(255, 255, 255, 0.5)' 
                  }
                ]} 
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.instructionsContainer} pointerEvents="none">
        <Text style={styles.instructionsText}>Swipe left or right to dismiss</Text>
      </View>
    </View>
  );
}
