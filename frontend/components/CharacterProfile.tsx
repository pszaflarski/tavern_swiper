import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
} from 'react-native';
import { Colors, Fonts, Radius, Spacing, Shadow } from '../theme';

interface CoreAttributes {
  strength: number;
  charisma: number;
  spark: number;
}

export interface CharacterProfileData {
  profile_id: string;
  user_id: string;
  display_name: string;
  tagline?: string;
  bio?: string;
  character_class?: string;
  realm?: string;
  talents: string[];
  attributes: CoreAttributes;
  image_url?: string;
  gender?: string;
}

interface AttributeBarProps {
  label: string;
  value: number;  // 1–10
  emoji: string;
}

function AttributeBar({ label, value, emoji }: AttributeBarProps) {
  const filled = Math.min(Math.max(value, 0), 10);
  return (
    <View style={styles.attrRow}>
      <Text style={styles.attrEmoji}>{emoji}</Text>
      <View style={styles.attrInfo}>
        <View style={styles.attrLabelRow}>
          <Text style={styles.attrLabel}>{label}</Text>
          <Text style={styles.attrValue}>{filled}/10</Text>
        </View>
        <View style={styles.attrTrack}>
          <View style={[styles.attrFill, { width: `${filled * 10}%` }]} />
        </View>
      </View>
    </View>
  );
}

interface CharacterProfileProps {
  profile: CharacterProfileData;
  onSendQuest?: () => void;  // CTA button
  onEdit?: () => void;
  onLogout?: () => void;
  isOwnProfile?: boolean;
}

export default function CharacterProfile({
  profile,
  onSendQuest,
  onEdit,
  onLogout,
  isOwnProfile = false,
}: CharacterProfileProps) {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero section — asymmetric image offset */}
      <View style={styles.heroSection}>
        {profile.image_url ? (
          <Image source={{ uri: profile.image_url }} style={styles.heroImage} />
        ) : (
          <View style={styles.heroImagePlaceholder}>
            <Text style={styles.heroPlaceholderEmoji}>⚔️</Text>
          </View>
        )}
        {/* Glassmorphism overlay */}
        <View style={styles.heroOverlay} />
        <View style={styles.heroTextContainer}>
          {!!profile.character_class && (
            <Text style={styles.characterClass}>{profile.character_class.toUpperCase()}</Text>
          )}
          <Text style={styles.heroName}>{profile.display_name}</Text>
          {!!profile.realm && (
            <Text style={styles.realm}>📍 {profile.realm}</Text>
          )}
        </View>
      </View>

      {/* Tagline */}
      {!!profile.tagline && (
        <View style={styles.section}>
          <Text style={styles.tagline}>"{profile.tagline}"</Text>
        </View>
      )}

      {/* Bio */}
      {!!profile.bio && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>The Chronicle</Text>
          <Text style={styles.bio}>{profile.bio}</Text>
        </View>
      )}

      {/* Core Attributes — from Character Forge Stitch screen */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Core Attributes</Text>
        <View style={styles.attributeCard}>
          <AttributeBar
            label="Strength"
            value={profile.attributes.strength}
            emoji="⚔️"
          />
          <AttributeBar
            label="Charisma"
            value={profile.attributes.charisma}
            emoji="🪄"
          />
          <AttributeBar
            label="Spark"
            value={profile.attributes.spark}
            emoji="✨"
          />
        </View>
      </View>

      {/* Talents & Hobbies — Affinity Sigils */}
      {profile.talents.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Talents & Hobbies</Text>
          <View style={styles.talentsGrid}>
            {profile.talents.map((talent) => (
              <View key={talent} style={styles.sigil}>
                <Text style={styles.sigilText}>{talent}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* CTA */}
      <View style={styles.ctaSection}>
        {isOwnProfile ? (
          <TouchableOpacity style={styles.primaryButton} onPress={onEdit} activeOpacity={0.85}>
            <Text style={styles.primaryButtonText}>Edit Hero</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primaryButton} onPress={onSendQuest} activeOpacity={0.85}>
            <Text style={styles.primaryButtonText}>Send a Quest</Text>
          </TouchableOpacity>
        )}

        {isOwnProfile && onLogout && (
          <TouchableOpacity 
            style={[styles.primaryButton, { marginTop: Spacing[4], backgroundColor: Colors.surfaceContainerHighest, borderWidth: 1, borderColor: Colors.outlineVariant }]} 
            onPress={onLogout} 
            activeOpacity={0.85}
          >
            <Text style={[styles.primaryButtonText, { color: Colors.error }]}>Exit Tavern</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  content: {
    paddingBottom: Spacing[12],
  },

  // Hero section
  heroSection: {
    position: 'relative',
    height: 380,
    marginBottom: Spacing[2],
  },
  heroImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  heroImagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlaceholderEmoji: {
    fontSize: 80,
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.primary,
    opacity: 0.45,
  },
  heroTextContainer: {
    position: 'absolute',
    bottom: Spacing[6],
    left: Spacing[6],
    right: Spacing[6],
    gap: Spacing[1],
  },
  characterClass: {
    fontFamily: Fonts.scribe,
    fontSize: 11,
    letterSpacing: 2,
    color: Colors.tertiaryFixedDim,
    textTransform: 'uppercase',
  },
  heroName: {
    fontFamily: Fonts.heroic,
    fontSize: 32,
    fontWeight: '700',
    color: Colors.onPrimary,
  },
  realm: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.primaryFixed,
  },

  // Sections
  section: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[6],
    gap: Spacing[3],
  },
  sectionTitle: {
    fontFamily: Fonts.heroic,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.onSurface,
    letterSpacing: 0.5,
  },
  tagline: {
    fontFamily: Fonts.heroic,
    fontSize: 18,
    fontStyle: 'italic',
    color: Colors.onSurfaceVariant,
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[5],
    textAlign: 'center',
  },
  bio: {
    fontFamily: Fonts.scribe,
    fontSize: 15,
    color: Colors.onSurface,
    lineHeight: 24,
  },

  // Attribute bars
  attributeCard: {
    backgroundColor: Colors.surfaceContainerLow,
    borderRadius: Radius.lg,
    padding: Spacing[5],
    gap: Spacing[5],
  },
  attrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[3],
  },
  attrEmoji: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },
  attrInfo: {
    flex: 1,
    gap: Spacing[1],
  },
  attrLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  attrLabel: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.onSurfaceVariant,
  },
  attrValue: {
    fontFamily: Fonts.scribe,
    fontSize: 12,
    color: Colors.tertiary,
  },
  attrTrack: {
    height: 6,
    backgroundColor: Colors.surfaceContainerHighest,
    borderRadius: Radius.full,
    overflow: 'hidden',
  },
  attrFill: {
    height: '100%',
    backgroundColor: Colors.tertiary,  // burnt gold
    borderRadius: Radius.full,
  },

  // Talents / Affinity Sigils
  talentsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  sigil: {
    backgroundColor: Colors.tertiaryContainer,
    paddingHorizontal: Spacing[3],
    paddingVertical: Spacing[2],
    borderRadius: Radius.sm,
  },
  sigilText: {
    fontFamily: Fonts.scribe,
    fontSize: 13,
    color: Colors.onTertiaryContainer,
  },

  // CTA
  ctaSection: {
    paddingHorizontal: Spacing[6],
    paddingTop: Spacing[8],
  },
  primaryButton: {
    backgroundColor: Colors.secondary,
    borderRadius: Radius.full,
    paddingVertical: Spacing[4],
    alignItems: 'center',
    // Velvet gradient approximated via solid color + shadow
    ...Shadow.waxSeal,
  },
  primaryButtonText: {
    fontFamily: Fonts.scribe,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.onSecondary,
    letterSpacing: 0.5,
  },
});
