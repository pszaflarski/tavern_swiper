import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Image,
  TouchableOpacity,
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

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = Math.min(SCREEN_W - Spacing[8] * 2, 450);
const SWIPE_THRESHOLD = SCREEN_W * 0.35;
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
}

export function SwipeCard({ profile, isTop, index, onSwipeLeft, onSwipeRight }: SwipeCardProps) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const handleSwipeLeft = useCallback((id: string) => onSwipeLeft(id), [onSwipeLeft]);
  const handleSwipeRight = useCallback((id: string) => onSwipeRight(id), [onSwipeRight]);

  const gesture = Gesture.Pan()
    .enabled(isTop)
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
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, animatedStyle]} testID="profile-card">
        {profile.image_urls && profile.image_urls[0] ? (
          <Image 
            source={{ uri: profile.image_urls[0] }} 
            style={styles.image} 
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderText}>⚔️</Text>
          </View>
        )}

        <Animated.View style={[styles.overlayLabel, styles.overlayRight, likeOpacity]}>
          <Text style={styles.overlayTextRight}>QUEST</Text>
        </Animated.View>

        <Animated.View style={[styles.overlayLabel, styles.overlayLeft, nopeOpacity]}>
          <Text style={styles.overlayTextLeft}>BANISH</Text>
        </Animated.View>

        <View style={styles.info}>
          <Text style={styles.name} testID="profile-card-name">{profile.display_name}</Text>
          {profile.bio && (
            <Text style={styles.tagline}>{profile.bio}</Text>
          )}
        </View>
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
  if (profiles.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>The Tavern is Quiet...</Text>
        <Text style={styles.emptySubtitle}>No more heroes to discover. Check back soon.</Text>
      </View>
    );
  }

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
            onSwipeLeft={onSwipeLeft}
            onSwipeRight={onSwipeRight}
          />
        ))
        .reverse()}
    </View>
  );
}

const styles = StyleSheet.create({
  deckContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  card: {
    position: 'absolute',
    width: CARD_W,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    ...Shadow.waxSeal,
    borderTopLeftRadius: Radius.cardTL,
    borderTopRightRadius: Radius.cardTR,
    borderBottomLeftRadius: Radius.cardBL,
    borderBottomRightRadius: Radius.cardBR,
  },
  image: {
    width: '100%',
    height: 420,
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    width: '100%',
    height: 420,
    backgroundColor: Colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: {
    fontSize: 72,
  },
  overlayLabel: {
    position: 'absolute',
    top: Spacing[10],
    paddingHorizontal: Spacing[5],
    paddingVertical: Spacing[2],
    borderWidth: 3,
    borderRadius: Radius.sm,
    zIndex: 10,
  },
  overlayRight: {
    left: Spacing[5],
    borderColor: Colors.tertiary,
    transform: [{ rotate: '-15deg' }],
  },
  overlayLeft: {
    right: Spacing[5],
    borderColor: Colors.error,
    transform: [{ rotate: '15deg' }],
  },
  overlayTextRight: {
    fontFamily: Fonts.heroic,
    fontSize: 28,
    fontWeight: '700',
    color: Colors.tertiary,
  },
  overlayTextLeft: {
    fontFamily: Fonts.heroic,
    fontSize: 28,
    fontWeight: '700',
    color: Colors.error,
  },
  info: {
    padding: Spacing[5],
    backgroundColor: Colors.surfaceContainerLowest,
    gap: Spacing[2],
  },
  name: {
    fontFamily: Fonts.heroic,
    fontSize: 24,
    fontWeight: '700',
    color: Colors.onSurface,
  },
  characterClass: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  tagline: {
    fontFamily: Fonts.scribe,
    fontSize: 15,
    color: Colors.onSurfaceVariant,
    fontStyle: 'italic',
  },
  talentsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
    marginTop: Spacing[1],
  },
  sigil: {
    backgroundColor: Colors.tertiaryContainer,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[1],
    borderRadius: Radius.sm,
  },
  sigilText: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.onTertiaryContainer,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[10],
    gap: Spacing[3],
  },
  emptyTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 24,
    color: Colors.onSurface,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: Fonts.scribe,
    fontSize: 15,
    color: Colors.onSurfaceVariant,
    textAlign: 'center',
  },
});
