import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, Fonts } from '../../theme';
import { useProfile } from '../../hooks/useProfiles';
import { Ionicons } from '@expo/vector-icons';
import { SwipeCard, SwipeProfile } from '../../components/SwipeDeck';
import DiceLoadingScreen from '../../components/DiceLoadingScreen';
import { styles } from './styles';

export default function ProfilePreviewScreen() {
  const { id, previewData } = useLocalSearchParams<{ id?: string, previewData?: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();

  // If previewData is provided (from the form), parse it. Otherwise, fetch by ID.
  let parsedPreviewData: SwipeProfile | null = null;
  try {
    parsedPreviewData = previewData ? JSON.parse(previewData) : null;
  } catch (e) {
    console.warn('[ProfilePreviewScreen] Failed to parse previewData param:', e);
  }
  const { data: fetchedProfile, isLoading } = useProfile(parsedPreviewData ? undefined : id);

  const profile: SwipeProfile | null = parsedPreviewData || (fetchedProfile as SwipeProfile | null);
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  const handleDismiss = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profiles' as any);
    }
  };

  if (isLoading) {
    return <DiceLoadingScreen message="Summoning the vision..." />;
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

      {showDetails && (
        <View style={styles.detailsOverlay}>
          <ScrollView 
            style={styles.detailsScroll}
            contentContainerStyle={styles.detailsContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.detailsName}>{profile.display_name}</Text>
            {profile.tagline && (
              <Text style={styles.detailsTagline}>"{profile.tagline}"</Text>
            )}
            <View style={styles.divider} />
            <Text style={styles.detailsBio}>
              {profile.bio || "This hero's story is yet to be written in the annals of the realm."}
            </Text>
            {((profile as any).gender?.length > 0 || (profile as any).race?.length > 0 || (profile as any).fandom?.length > 0) && (
               <>
                <View style={styles.divider} />
                <Text style={styles.detailsLabel}>Attributes</Text>
                {(profile as any).gender && (profile as any).gender.length > 0 && (
                  <Text style={styles.detailsBio}>Gender: {(profile as any).gender.map((t: any) => t.name).join(', ')}</Text>
                )}
                {(profile as any).race && (profile as any).race.length > 0 && (
                  <Text style={styles.detailsBio}>Race: {(profile as any).race.map((t: any) => t.name).join(', ')}</Text>
                )}
                {(profile as any).fandom && (profile as any).fandom.length > 0 && (
                  <Text style={styles.detailsBio}>Fandom: {(profile as any).fandom.map((t: any) => t.name).join(', ')}</Text>
                )}
               </>
            )}
            {/* Spacer for the footer area to ensure text isn't cut off by buttons */}
            <View style={{ height: 160 }} />
          </ScrollView>
        </View>
      )}

      <Pressable 
        style={({ pressed }) => [
          styles.infoButton,
          pressed && { opacity: 0.7 }
        ]}
        onPress={() => setShowDetails(!showDetails)} 
        testID="profile-info-button"
      >
        <Ionicons 
          name={showDetails ? "close-circle-outline" : "information-circle-outline"} 
          size={28} 
          color={Colors.onSurface} 
        />
      </Pressable>

      <View style={styles.instructionsContainer} pointerEvents="none">
        <Text style={styles.instructionsText}>Swipe left or right to dismiss</Text>
      </View>
    </View>
  );
}
