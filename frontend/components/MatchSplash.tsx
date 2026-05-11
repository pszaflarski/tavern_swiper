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
  ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts, Radius, Spacing, Shadow } from '../theme';
import { useMatch } from '../context/MatchContext';
import { useProfileContext } from '../context/ProfileContext';
import { useCreateConversation } from '../hooks/useMessages';
import { router } from 'expo-router';
import { styles } from './MatchSplash.styles';

export default function MatchSplash() {
  const { isMatchVisible, hideMatch, matchedProfile, clearMatchedProfile } = useMatch();
  const { activeProfileId, profiles } = useProfileContext();
  const insets = useSafeAreaInsets();
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();

  const activeProfile = profiles.find((p) => p.profile_id === activeProfileId);
  const { mutateAsync: createConversation } = useCreateConversation();

  const handleInitiateConversation = () => {
    if (!activeProfileId || !matchedProfile) return;
    const matchedProfileId = matchedProfile.profile_id;
    
    // Optimistic UX: dismiss splash and navigate to messages tab immediately
    hideMatch();
    router.push('/(tabs)/messages');

    // Retry conversation creation in the background with exponential backoff.
    // The match is created via an event-driven pipeline, so the messages service
    // may not have the match record yet when we first call.
    const MAX_RETRIES = 5;
    const BASE_DELAY_MS = 500;

    (async () => {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const data = await createConversation({
            participants: [activeProfileId, matchedProfileId],
          });
          // Success — navigate to the conversation
          router.push(`/messages/${data.conversation_id}`);
          return;
        } catch (error) {
          if (attempt < MAX_RETRIES - 1) {
            const delay = attempt === 0 ? BASE_DELAY_MS : BASE_DELAY_MS * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.warn('Failed to create conversation after retries:', error);
          }
        }
      }
    })();
  };

  // Card sizing — 16:9 portrait aspect ratio
  const CARD_W = SCREEN_W * 0.34;
  const CARD_H = CARD_W * (16 / 9);

  // Calculate max offset so rotated cards sit at edges without clipping
  const ROTATION_DEG = 6;
  const ROTATION_RAD = (ROTATION_DEG * Math.PI) / 180;
  const ROTATED_HALF_W = (CARD_W * Math.cos(ROTATION_RAD) + CARD_H * Math.sin(ROTATION_RAD)) / 2;
  const AVAILABLE_HALF_W = (SCREEN_W - 2 * Spacing[6]) / 2;
  const CARD_OFFSET = Math.max(0, AVAILABLE_HALF_W - ROTATED_HALF_W - Spacing[1]);

  // Animation values
  const leftCardX = useSharedValue(-SCREEN_W);
  const rightCardX = useSharedValue(SCREEN_W);
  const textScale = useSharedValue(0);
  const overlayOpacity = useSharedValue(0);

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

  useEffect(() => {
    if (isMatchVisible) {
      overlayOpacity.value = withTiming(1, { duration: 400 });
      leftCardX.value = withDelay(300, withSpring(0, { damping: 14 }));
      rightCardX.value = withDelay(500, withSpring(0, { damping: 14 }));
      textScale.value = withDelay(800, withSpring(1, { damping: 12 }));
    } else {
      leftCardX.value = withTiming(-SCREEN_W, { duration: 300 });
      rightCardX.value = withTiming(SCREEN_W, { duration: 300 });
      textScale.value = withTiming(0, { duration: 200 });
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
            paddingTop: insets.top + Spacing[4],
            paddingBottom: insets.bottom + Spacing[4],
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
        <View style={[styles.cardsContainer, { height: CARD_H + Spacing[8] }]}>
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
        <Animated.View entering={ZoomIn.delay(1200)} style={styles.actions}>
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

