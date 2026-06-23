import React, { useEffect } from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  useWindowDimensions,
  StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts, Radius, Spacing, Shadow } from '../theme';
import { useMatch } from '../context/MatchContext';
import { useProfileContext } from '../context/ProfileContext';

import { router } from 'expo-router';
import { styles } from './MatchSplash.styles';

export default function MatchSplash() {
  const { isMatchVisible, hideMatch, matchedProfile, clearMatchedProfile } = useMatch();
  const { activeProfileId, profiles } = useProfileContext();
  const insets = useSafeAreaInsets();
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();

  const activeProfile = profiles.find((p) => p.profile_id === activeProfileId);


  const handleInitiateConversation = () => {
    if (!activeProfileId || !matchedProfile) return;
    const matchedProfileId = matchedProfile.profile_id;
    
    // Dismiss splash and navigate straight to the new conversation screen
    hideMatch();
    router.push(`/messages/new_${matchedProfileId}`);
  };

  // Card sizing — height-driven for taller cards on mobile
  const CARD_H = SCREEN_H * 0.50;
  const CARD_W = CARD_H * (3 / 5);

  // Offset: push each card out by ~25% of card width so they overlap in center
  const CARD_OFFSET = CARD_W * 0.25;

  // Animation values
  const leftCardX = useSharedValue(-SCREEN_W);
  const rightCardX = useSharedValue(SCREEN_W);
  const textScale = useSharedValue(0);
  const overlayOpacity = useSharedValue(0);
  const actionsScale = useSharedValue(0);

  const leftCardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: leftCardX.value - CARD_OFFSET },
      { rotate: '-6deg' },
    ],
  }));

  const rightCardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: rightCardX.value + CARD_OFFSET },
      { rotate: '6deg' },
    ],
  }));

  const textStyle = useAnimatedStyle(() => ({
    transform: [{ scale: textScale.value }],
  }));

  const rootStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const actionsStyle = useAnimatedStyle(() => ({
    transform: [{ scale: actionsScale.value }],
    opacity: actionsScale.value,
  }));

  useEffect(() => {
    if (isMatchVisible) {
      overlayOpacity.value = withTiming(1, { duration: 400 });
      leftCardX.value = withDelay(300, withSpring(0, { damping: 14 }));
      rightCardX.value = withDelay(500, withSpring(0, { damping: 14 }));
      textScale.value = withDelay(800, withSpring(1, { damping: 12 }));
      actionsScale.value = withDelay(1200, withSpring(1, { damping: 12 }));
    } else {
      leftCardX.value = withTiming(-SCREEN_W, { duration: 300 });
      rightCardX.value = withTiming(SCREEN_W, { duration: 300 });
      textScale.value = withTiming(0, { duration: 200 });
      actionsScale.value = withTiming(0, { duration: 200 });
      overlayOpacity.value = withTiming(0, { duration: 300 }, (finished) => {
        if (finished) {
          runOnJS(clearMatchedProfile)();
        }
      });
    }
  }, [isMatchVisible]);

  if (!matchedProfile) return null;

  return (
    <Animated.View 
      style={[StyleSheet.absoluteFill, { zIndex: 999 }, rootStyle]}
      pointerEvents={isMatchVisible ? 'auto' : 'none'}
    >
      <View style={styles.overlay} />
      
      <View
        style={[
          styles.container,
          {
            paddingTop: (insets?.top ?? 0) + Spacing[4],
            paddingBottom: (insets?.bottom ?? 0) + Spacing[4],
          }
        ]}
      >

        {/* Magical Background Glow */}
        <View style={styles.glow} />

        {/* Title */}
        <Animated.View style={[styles.textContainer, textStyle]}>
          <Text style={styles.matchTitle}>Fate Decided!</Text>
          <Text style={styles.matchSubtitle}>A Mutual Bond Has Been Forged</Text>
        </Animated.View>

        {/* Overlapping Cards — matched profile on top */}
        <View style={[styles.cardsContainer, { height: CARD_H + Spacing[4] }]}>
          {/* Your Profile (behind, tilted left) */}
          <Animated.View style={[
            styles.card, 
            { 
              width: CARD_W, 
              height: CARD_H,
              position: 'absolute',
            }, 
            leftCardStyle
          ]}>
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

          {/* Matched Profile (on top, tilted right) */}
          <Animated.View style={[
            styles.card, 
            { 
              width: CARD_W, 
              height: CARD_H,
              position: 'absolute',
              zIndex: 2,
            }, 
            rightCardStyle
          ]}>
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

        {/* Actions */}
        <Animated.View style={[styles.actions, { paddingBottom: (insets?.bottom ?? 0) + Spacing[4] }, actionsStyle]}>
          <Pressable 
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && { opacity: 0.8 }
            ]}
            onPress={handleInitiateConversation}
          >
            <Text style={styles.primaryButtonText}>INITIATE CONVERSATION</Text>
          </Pressable>

          <Pressable 
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && { opacity: 0.8 }
            ]}
            onPress={hideMatch}
          >
            <Text style={styles.secondaryButtonText}>Return to the Tavern</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

