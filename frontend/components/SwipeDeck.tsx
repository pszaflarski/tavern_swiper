import React, { useCallback, useState, useEffect } from 'react';
import {
  View,
  Text,
  Dimensions,
  Image,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Colors, Fonts, Radius, Shadow, Spacing } from '../theme';
import { styles } from './SwipeDeck.styles';

const ROTATION_FACTOR = 15;

export interface SwipeProfile {
  profile_id: string;
  display_name: string;
  bio?: string;
  image_urls: string[];
}

interface SwipeCardProps {
  profile: SwipeProfile;
  isTop: boolean;
  index: number;
  onSwipeLeft: (profileId: string) => void;
  onSwipeRight: (profileId: string) => void;
  currentIndex: number;
  onIndexChange: (index: number) => void;
  cardWidth: number;
}

export function SwipeCard({ profile, isTop, index, onSwipeLeft, onSwipeRight, currentIndex, onIndexChange, cardWidth }: SwipeCardProps) {
  const { width: SCREEN_W } = useWindowDimensions();
  const SWIPE_THRESHOLD = SCREEN_W * 0.35;

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const handleSwipeLeft = useCallback((id: string) => onSwipeLeft(id), [onSwipeLeft]);
  const handleSwipeRight = useCallback((id: string) => onSwipeRight(id), [onSwipeRight]);

  const gesture = Gesture.Pan()
    .enabled(isTop)
    .minDistance(10)
    .onUpdate((e) => {
      translateX.value = e.translationX;
      translateY.value = e.translationY * 0.3;
    })
    .onEnd((e) => {
      if (e.translationX > SWIPE_THRESHOLD) {
        translateX.value = withTiming(SCREEN_W * 1.5, { duration: 280 });
        runOnJS(handleSwipeRight)(profile.profile_id);
      } else if (e.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withTiming(-SCREEN_W * 1.5, { duration: 280 });
        runOnJS(handleSwipeLeft)(profile.profile_id);
      } else {
        translateX.value = withSpring(0, { damping: 15 });
        translateY.value = withSpring(0, { damping: 15 });
      }
    });
  
  const tapGesture = Gesture.Tap()
    .enabled(isTop)
    .onFinalize((e) => {
      const isRight = e.x > SCREEN_W / 2;
      const total = profile.image_urls?.length ?? 1;
      runOnJS(onIndexChange)(
        isRight 
          ? Math.min(currentIndex + 1, total - 1)
          : Math.max(currentIndex - 1, 0)
      );
    });

  const combinedGesture = Gesture.Exclusive(gesture, tapGesture);

  const animatedStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      translateX.value,
      [-SCREEN_W, 0, SCREEN_W],
      [-ROTATION_FACTOR, 0, ROTATION_FACTOR],
      Extrapolation.CLAMP,
    );
    const scale = isTop ? 1 : interpolate(index, [1, 2, 3], [0.96, 0.92, 0.88]);
    const stackY = isTop ? 0 : index * 8;
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value + stackY },
        { rotate: `${rotate}deg` },
        { scale },
      ],
    };
  });

  const likeOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD * 0.5], [0, 1], Extrapolation.CLAMP),
  }));
  const nopeOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD * 0.5, 0], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={combinedGesture}>
      <Animated.View style={[styles.card, { width: cardWidth }, animatedStyle]} testID="profile-card">
        <>
          {profile.image_urls && profile.image_urls[currentIndex] ? (
            <Image 
              source={{ uri: profile.image_urls[currentIndex] }} 
              style={styles.image} 
              resizeMode="contain"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>⚔️</Text>
            </View>
          )}

          <View style={styles.heroInfo}>
            <Text style={styles.heroName} testID="hero-name">{profile.display_name}</Text>
            {profile.bio && (
              <Text style={styles.heroTagline} testID="hero-tagline">{profile.bio}</Text>
            )}
          </View>

          <Animated.View style={[styles.overlayLabel, styles.overlayRight, likeOpacity]}>
            <Text style={styles.overlayTextRight}>QUEST</Text>
          </Animated.View>

          <Animated.View style={[styles.overlayLabel, styles.overlayLeft, nopeOpacity]}>
            <Text style={styles.overlayTextLeft}>BANISH</Text>
          </Animated.View>
        </>
      </Animated.View>
    </GestureDetector>
  );
}

interface SwipeDeckProps {
  profiles: SwipeProfile[];
  onSwipeLeft: (profileId: string) => void;
  onSwipeRight: (profileId: string) => void;
}

export default function SwipeDeck({ profiles, onSwipeLeft, onSwipeRight }: SwipeDeckProps) {
  const { width: SCREEN_W } = useWindowDimensions();
  const CARD_W = SCREEN_W;
  const [topImageIndex, setTopImageIndex] = useState(0);

  // Reset index when the top character changes
  const topProfileId = profiles[0]?.profile_id;
  useEffect(() => {
    setTopImageIndex(0);
  }, [topProfileId]);

  if (profiles.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>The Tavern is Quiet...</Text>
        <Text style={styles.emptySubtitle}>No more heroes to discover. Check back soon.</Text>
      </View>
    );
  }

  const topProfile = profiles[0];

  return (
    <View style={styles.deckContainer}>
      {profiles
        .slice(0, 4)
        .map((profile, index) => (
          <SwipeCard
            key={profile.profile_id}
            profile={profile}
            isTop={index === 0}
            index={index}
            currentIndex={index === 0 ? topImageIndex : 0}
            onIndexChange={setTopImageIndex}
            onSwipeLeft={onSwipeLeft}
            onSwipeRight={onSwipeRight}
            cardWidth={CARD_W}
          />
        ))
        .reverse()}

      {/* Static Indicators anchored to the "header" area */}
      {topProfile && topProfile.image_urls && topProfile.image_urls.length >= 1 && (
        <View style={styles.indicatorContainer} pointerEvents="none" testID="indicator-container">
          {topProfile.image_urls.map((_, i) => (
            <View 
              key={i} 
              testID={`indicator-segment-${i}`}
              style={[
                styles.indicator, 
                { 
                  backgroundColor: i === topImageIndex 
                    ? Colors.tertiary 
                    : 'rgba(255, 255, 255, 0.5)' 
                }
              ]} 
            />
          ))}
        </View>
      )}
    </View>
  );
}

