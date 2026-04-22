import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
  FadeIn,
  FadeOut,
  ZoomIn,
} from 'react-native-reanimated';
import { Colors, Fonts, Radius, Spacing, Shadow } from '../theme';
import { useMatch } from '../context/MatchContext';
import { useProfileContext } from '../context/ProfileContext';

const { width: SCREEN_W } = Dimensions.get('window');

const CARD_W = SCREEN_W * 0.35;
const CARD_H = CARD_W * (16 / 9);

export default function MatchSplash() {
  const { isMatchVisible, hideMatch, matchedProfile } = useMatch();
  const { activeProfileId, profiles } = useProfileContext();

  const activeProfile = profiles.find((p) => p.profile_id === activeProfileId);

  // ALL hooks must be called before any conditional return
  const leftCardX = useSharedValue(-SCREEN_W);
  const rightCardX = useSharedValue(SCREEN_W);
  const textScale = useSharedValue(0);

  const leftCardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: leftCardX.value - Spacing[4] },
      { rotate: '-8deg' },
    ],
  }));

  const rightCardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: rightCardX.value + Spacing[4] },
      { rotate: '8deg' },
    ],
  }));

  const textStyle = useAnimatedStyle(() => ({
    transform: [{ scale: textScale.value }],
  }));

  useEffect(() => {
    if (isMatchVisible) {
      leftCardX.value = withDelay(300, withSpring(0, { damping: 12 }));
      rightCardX.value = withDelay(500, withSpring(0, { damping: 12 }));
      textScale.value = withDelay(800, withSpring(1, { damping: 10 }));
    } else {
      leftCardX.value = -SCREEN_W;
      rightCardX.value = SCREEN_W;
      textScale.value = 0;
    }
  }, [isMatchVisible]);

  // Conditional return AFTER all hooks
  if (!isMatchVisible || !matchedProfile) return null;

  return (
    <Animated.View 
      entering={FadeIn.duration(400)} 
      exiting={FadeOut.duration(300)}
      style={StyleSheet.absoluteFill}
    >
      <View style={styles.overlay} />
      
      <View style={styles.container}>
        {/* Magical Background Glow */}
        <Animated.View 
          entering={FadeIn.delay(200).duration(1000)}
          style={styles.glow} 
        />

        <Animated.View style={[styles.textContainer, textStyle]}>
          <Text style={styles.matchTitle}>Fate Decided!</Text>
          <Text style={styles.matchSubtitle}>A Mutual Bond Has Been Forged</Text>
        </Animated.View>

        <View style={styles.cardsContainer}>
          {/* Your Profile */}
          <Animated.View style={[styles.card, leftCardStyle]}>
            <View style={styles.imageWrapper}>
              {activeProfile?.image_urls?.[0] ? (
                <Image source={{ uri: activeProfile.image_urls[0] }} style={styles.image} />
              ) : (
                <View style={styles.placeholder}><Text style={styles.emoji}>🛡️</Text></View>
              )}
            </View>
            <View style={styles.cardLabel}>
              <Text style={styles.cardLabelText} numberOfLines={1}>{activeProfile?.display_name || 'You'}</Text>
            </View>
          </Animated.View>

          {/* Matched Profile */}
          <Animated.View style={[styles.card, rightCardStyle]}>
            <View style={styles.imageWrapper}>
              {matchedProfile.image_url ? (
                <Image source={{ uri: matchedProfile.image_url }} style={styles.image} />
              ) : (
                <View style={styles.placeholder}><Text style={styles.emoji}>⚔️</Text></View>
              )}
            </View>
            <View style={styles.cardLabel}>
              <Text style={styles.cardLabelText} numberOfLines={1}>{matchedProfile.display_name}</Text>
            </View>
          </Animated.View>
        </View>

        <Animated.View entering={ZoomIn.delay(1200)} style={styles.actions}>
          <TouchableOpacity 
            style={styles.primaryButton}
            onPress={() => {
              // TODO: Navigate to messages
              hideMatch();
            }}
          >
            <Text style={styles.primaryButtonText}>INITIATE CONVERSATION</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.secondaryButton}
            onPress={hideMatch}
          >
            <Text style={styles.secondaryButtonText}>Return to the Tavern</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  glow: {
    position: 'absolute',
    width: SCREEN_W * 1.5,
    height: SCREEN_W * 1.5,
    borderRadius: SCREEN_W * 0.75,
    backgroundColor: Colors.secondary,
    opacity: 0.15,
    zIndex: -1,
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: Spacing[12],
  },
  matchTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 48,
    color: Colors.tertiary,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  matchSubtitle: {
    fontFamily: Fonts.scribe,
    fontSize: 18,
    color: Colors.onSurfaceVariant,
    marginTop: Spacing[2],
    fontStyle: 'italic',
    textAlign: 'center',
  },
  cardsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: CARD_H + 40,
    width: '100%',
  },
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: Colors.surfaceContainer,
    borderRadius: Radius.md,
    borderWidth: 3,
    borderColor: Colors.tertiary,
    ...Shadow.waxSeal,
    elevation: 20,
    overflow: 'hidden',
  },
  imageWrapper: {
    flex: 1,
    backgroundColor: Colors.surfaceVariant,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 32,
  },
  cardLabel: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: Spacing[2],
    paddingHorizontal: Spacing[2],
    alignItems: 'center',
  },
  cardLabelText: {
    fontFamily: Fonts.heroic,
    fontSize: 14,
    color: Colors.onPrimary,
    fontWeight: '700',
  },
  actions: {
    marginTop: Spacing[16],
    width: '100%',
    gap: Spacing[4],
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing[4],
    borderRadius: Radius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.primaryFixedDim,
    ...Shadow.waxSeal,
  },
  primaryButtonText: {
    fontFamily: Fonts.heroic,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.onPrimary,
    letterSpacing: 1.5,
  },
  secondaryButton: {
    paddingVertical: Spacing[3],
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: Fonts.scribe,
    fontSize: 16,
    color: Colors.onSurfaceVariant,
    textDecorationLine: 'underline',
  },
});
