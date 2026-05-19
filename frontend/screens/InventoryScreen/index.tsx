import React, { useState } from 'react';
import { View, Text, ScrollView, Image, Pressable, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import ScreenErrorBoundary from '../../components/ScreenErrorBoundary';
import { Colors, Spacing } from '../../theme';
import { styles } from './styles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ItemAction = 'use' | 'trade' | 'gift' | 'equip';

interface InventoryItem {
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
// Mock data — will be replaced with a real API call to quests service later
// ---------------------------------------------------------------------------
const MOCK_INVENTORY: InventoryItem[] = [
  {
    item_id: 'gold',
    name: 'Gold',
    description: 'The universal currency of the realm. Earned through quests, wagers, and the goodwill of fellow adventurers.',
    quantity: 350,
    image: require('../../assets/images/inventory_icon_gold.png'),
    actions: ['trade', 'gift'],
  },
  {
    item_id: 'dice_d4',
    name: 'Standard D4 Dice',
    description: 'A four-sided die carved from enchanted stone. Favoured by rogues for quick, decisive rolls.',
    quantity: 8,
    image: require('../../assets/dice/triangle/4.png'),
    actions: ['use'],
    dieType: 'd4',
  },
  {
    item_id: 'dice_d6',
    name: 'Standard D6 Dice',
    description: 'The classic six-sided die. Reliable, sturdy, and the backbone of any adventurer\'s pouch.',
    quantity: 12,
    image: require('../../assets/dice/square/6.png'),
    actions: ['use'],
    dieType: 'd6',
  },
  {
    item_id: 'dice_d8',
    name: 'Standard D8 Dice',
    description: 'An eight-sided die humming with faint arcane energy. A step above the ordinary.',
    quantity: 5,
    image: require('../../assets/dice/triangle/8.png'),
    actions: ['use'],
    dieType: 'd8',
  },
  {
    item_id: 'dice_d12',
    name: 'Standard D12 Dice',
    description: 'A twelve-sided die, rarely seen outside the vaults of seasoned dungeon-delvers.',
    quantity: 3,
    image: require('../../assets/dice/pentagon/12.png'),
    actions: ['use'],
    dieType: 'd12',
  },
  {
    item_id: 'dice_d20',
    name: 'Standard D20 Dice',
    description: 'The legendary twenty-sided die. Every critical moment deserves one of these.',
    quantity: 1,
    image: require('../../assets/dice/triangle/20.png'),
    actions: ['use'],
    dieType: 'd20',
  },
];

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
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  // Whether we came from a conversation (enables actions)
  const inConversation = !!conversationId && !!profileId;

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

  const handleAction = (action: ItemAction, item: InventoryItem) => {
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
            <Image source={selectedItem.image} style={styles.detailIcon} resizeMode="contain" />
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
      ) : (
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.itemGrid, { gap: GRID_GAP }]}>
            {MOCK_INVENTORY.map((item) => (
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
                  <Image source={item.image} style={styles.itemIcon} resizeMode="contain" />
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
