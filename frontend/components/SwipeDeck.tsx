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
const CARD_W = SCREEN_W - Spacing[8] * 2;
const SWIPE_THRESHOLD = SCREEN_W * 0.35;
const ROTATION_FACTOR = 15; // degrees at full swipe

export interface SwipeProfile {
  profile_id: string;
  display_name: string;
  tagline?: string;
  character_class?: string;
  realm?: string;
  image_url?: string;
  talents: string[];
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
    // Deck stacking: non-top cards are scaled down and offset
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

  // Overlay indicators
  const likeOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, SWIPE_THRESHOLD * 0.5], [0, 1], Extrapolation.CLAMP),
  }));
  const nopeOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-SWIPE_THRESHOLD * 0.5, 0], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.card, animatedStyle]}>
        {/* Profile image */}
        {profile.image_url ? (
          <Image source={{ uri: profile.image_url }} style={styles.image} />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.imagePlaceholderText}>⚔️</Text>
          </View>
        )}

        {/* Right-swipe indicator */}
        <Animated.View style={[styles.overlayLabel, styles.overlayRight, likeOpacity]}>
          <Text style={styles.overlayTextRight}>QUEST</Text>
        </Animated.View>

        {/* Left-swipe indicator */}
        <Animated.View style={[styles.overlayLabel, styles.overlayLeft, nopeOpacity]}>
          <Text style={styles.overlayTextLeft}>PASS</Text>
        </Animated.View>

        {/* Profile info */}
        <View style={styles.info}>
          <Text style={styles.name}>{profile.display_name}</Text>
          {profile.character_class && (
            <Text style={styles.characterClass}>{profile.character_class}</Text>
          )}
          {profile.tagline && (
            <Text style={styles.tagline}>{profile.tagline}</Text>
          )}
          {profile.realm && (
            <Text style={styles.realm}>📍 {profile.realm}</Text>
          )}
          {/* Affinity Sigils (talents chips) */}
          {profile.talents.length > 0 && (
            <View style={styles.talentsRow}>
              {profile.talents.slice(0, 4).map((t) => (
                <View key={t} style={styles.sigil}>
                  <Text style={styles.sigilText}>{t}</Text>
                </View>
              ))}
            </View>
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
  onEmpty?: () => void;
}

export default function SwipeDeck({ profiles, onSwipeLeft, onSwipeRight, onEmpty }: SwipeDeckProps) {
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
      {/* Render in reverse so top card is on top */}
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
  },
  card: {
    position: 'absolute',
    width: CARD_W,
    backgroundColor: Colors.surfaceContainerLowest,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    ...Shadow.waxSeal,
    // Asymmetric corners per design system (approximated via uniform radius)
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
  realm: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.outline,
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
