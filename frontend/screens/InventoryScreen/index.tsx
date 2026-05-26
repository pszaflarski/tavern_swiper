import React, { useState } from 'react';
import { View, Text, ScrollView, Image, Pressable, useWindowDimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { Colors, Spacing } from '../../theme';
import DiceLoadingScreen from '../../components/DiceLoadingScreen';
import { styles } from './styles';
import { useUser } from '../../hooks/useUser';
import { useInventory, InventoryEntry } from '../../hooks/useInventory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ItemAction = 'use' | 'trade' | 'gift' | 'equip';

interface DisplayItem {
  item_id: string;
  name: string;
  description: string;
  quantity: number;
  image: any;
  actions: ItemAction[];
  dieType?: string; // e.g. 'd4', 'd6' — populated for dice items
}

// ---------------------------------------------------------------------------
// Action button config
// ---------------------------------------------------------------------------
const ACTION_CONFIG: Record<ItemAction, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  use:   { icon: 'flash-outline',    label: 'Use' },
  trade: { icon: 'swap-horizontal',  label: 'Trade' },
  gift:  { icon: 'gift-outline',     label: 'Gift' },
  equip: { icon: 'shield-outline',   label: 'Equip' },
};

// ---------------------------------------------------------------------------
// Local image mapping — dice assets are bundled, so we map item_id → require
// ---------------------------------------------------------------------------
const DICE_IMAGE_MAP: Record<string, any> = {
  dice_d4:  require('../../assets/dice/triangle/4.png'),
  dice_d6:  require('../../assets/dice/square/6.png'),
  dice_d8:  require('../../assets/dice/triangle/8.png'),
  dice_d12: require('../../assets/dice/pentagon/12.png'),
  dice_d20: require('../../assets/dice/triangle/20.png'),
};

const ITEM_IMAGE_MAP: Record<string, any> = {
  gold: require('../../assets/images/inventory_icon_gold.png'),
  ...DICE_IMAGE_MAP,
};

// Dice type lookup from item_id
const DICE_TYPE_MAP: Record<string, string> = {
  dice_d4:  'd4',
  dice_d6:  'd6',
  dice_d8:  'd8',
  dice_d12: 'd12',
  dice_d20: 'd20',
};

/**
 * Convert an API InventoryEntry into a DisplayItem for the UI.
 */
function toDisplayItem(entry: InventoryEntry): DisplayItem {
  return {
    item_id: entry.item_id,
    name: entry.name || entry.item_id,
    description: entry.description || '',
    quantity: entry.quantity,
    image: ITEM_IMAGE_MAP[entry.item_id] ?? null,
    actions: (entry.actions ?? []) as ItemAction[],
    dieType: DICE_TYPE_MAP[entry.item_id],
  };
}

const ITEM_MIN_WIDTH = 100;
const GRID_GAP = Spacing[3];
const GRID_PADDING = Spacing[4];

function InventoryScreenInner() {
  const router = useRouter();
  const { conversationId, profileId } = useLocalSearchParams<{
    conversationId?: string;
    profileId?: string;
  }>();
  const { width } = useWindowDimensions();
  const [selectedItem, setSelectedItem] = useState<DisplayItem | null>(null);

  // Fetch live data
  const { uid } = useUser();
  const { data: inventory, isLoading, isError, refetch } = useInventory(uid);

  // Whether we came from a conversation (enables actions)
  const inConversation = !!conversationId && !!profileId;

  // Transform API data into display items
  const items: DisplayItem[] = (inventory ?? []).map(toDisplayItem);

  // Calculate how many columns fit based on screen width
  const availableWidth = width - GRID_PADDING * 2;
  const numColumns = Math.max(2, Math.floor((availableWidth + GRID_GAP) / (ITEM_MIN_WIDTH + GRID_GAP)));
  const itemWidth = (availableWidth - GRID_GAP * (numColumns - 1)) / numColumns;

  const goBack = () => {
    if (selectedItem) {
      setSelectedItem(null);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/account' as any);
    }
  };

  const handleAction = (action: ItemAction, item: DisplayItem) => {
    if (!inConversation) return;

    if (action === 'use' && item.dieType) {
      // Navigate back to the conversation with the selected die equipped
      router.replace({
        pathname: '/(tabs)/messages/[id]',
        params: {
          id: conversationId!,
          equippedDie: item.dieType,
        },
      } as any);
    }
    // Other actions (trade, gift, equip) — TODO: wire up later
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={styles.container} testID="inventory-screen">
        <Stack.Screen
          options={{
            title: '',
            headerShown: true,
            headerStyle: { backgroundColor: Colors.surfaceContainerLowest },
            headerTintColor: Colors.onSurface,
            headerLeft: () => (
              <Pressable
                onPress={goBack}
                style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.7 }]}
                testID="inventory-back-button"
              >
                <Ionicons name="close" size={24} color={Colors.onSurface} />
              </Pressable>
            ),
          }}
        />
        <DiceLoadingScreen message="Opening your pouch…" />
      </View>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <View style={styles.container} testID="inventory-screen">
        <Stack.Screen
          options={{
            title: '',
            headerShown: true,
            headerStyle: { backgroundColor: Colors.surfaceContainerLowest },
            headerTintColor: Colors.onSurface,
            headerLeft: () => (
              <Pressable
                onPress={goBack}
                style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.7 }]}
                testID="inventory-back-button"
              >
                <Ionicons name="close" size={24} color={Colors.onSurface} />
              </Pressable>
            ),
          }}
        />
        <View style={styles.centeredContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
          <Text style={styles.centeredText}>Failed to load inventory</Text>
          <Pressable
            onPress={() => refetch()}
            style={({ pressed }) => [styles.retryButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="inventory-screen">
      <Stack.Screen
        options={{
          title: '',
          headerShown: true,
          headerStyle: { backgroundColor: Colors.surfaceContainerLowest },
          headerTintColor: Colors.onSurface,
          headerLeft: () => (
            <Pressable
              onPress={goBack}
              style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.7 }]}
              testID="inventory-back-button"
            >
              <Ionicons name="close" size={24} color={Colors.onSurface} />
            </Pressable>
          ),
        }}
      />

      {selectedItem ? (
        <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.detailName}>{selectedItem.name}</Text>

          <View style={styles.detailIconContainer}>
            {selectedItem.image ? (
              <Image source={selectedItem.image} style={styles.detailIcon} resizeMode="contain" />
            ) : (
              <Ionicons name="cube-outline" size={64} color={Colors.onSurfaceVariant} />
            )}
          </View>

          <Text style={styles.detailQuantity}>×{selectedItem.quantity.toLocaleString()} in pouch</Text>

          <Text style={styles.detailDescription}>{selectedItem.description}</Text>

          <View style={styles.actionButtonsContainer}>
            {selectedItem.actions.map((action) => {
              const config = ACTION_CONFIG[action];
              const isDisabled = !inConversation;

              return (
                <Pressable
                  key={action}
                  style={({ pressed }) => [
                    styles.actionButton,
                    isDisabled && styles.actionButtonDisabled,
                    pressed && !isDisabled && { opacity: 0.7 },
                  ]}
                  onPress={() => handleAction(action, selectedItem)}
                  disabled={isDisabled}
                  testID={`item-action-${action}`}
                >
                  <Ionicons
                    name={config.icon}
                    size={18}
                    color={isDisabled ? Colors.outline : Colors.onSurface}
                  />
                  <Text style={[
                    styles.actionButtonText,
                    isDisabled && { color: Colors.outline },
                  ]}>
                    {config.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {!inConversation && (
            <Text style={styles.disabledHint}>
              Open your inventory from a conversation to use items
            </Text>
          )}
        </ScrollView>
      ) : items.length === 0 ? (
        /* ── Empty state ──────────────────────────────────────────────── */
        <View style={styles.centeredContainer}>
          <Ionicons name="cube-outline" size={64} color={Colors.outlineVariant} />
          <Text style={styles.emptyTitle}>Your pouch is empty</Text>
          <Text style={styles.emptySubtitle}>
            Complete quests and chat with adventurers to earn items
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.itemGrid, { gap: GRID_GAP }]}>
            {items.map((item) => (
              <Pressable
                key={item.item_id}
                style={({ pressed }) => [
                  styles.itemCard,
                  { width: itemWidth },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => setSelectedItem(item)}
                testID={`inventory-item-${item.item_id}`}
              >
                <View style={styles.itemIconContainer}>
                  {item.image ? (
                    <Image source={item.image} style={styles.itemIcon} resizeMode="contain" />
                  ) : (
                    <Ionicons name="cube-outline" size={32} color={Colors.onSurfaceVariant} />
                  )}
                </View>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemQuantity}>×{item.quantity.toLocaleString()}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

export default function InventoryScreen() {
  return (
    <ScreenErrorBoundary fallbackMessage="The inventory chest could not be opened.">
      <InventoryScreenInner />
    </ScreenErrorBoundary>
  );
}
