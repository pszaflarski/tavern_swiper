import { useQuery } from '@tanstack/react-query';
import { questsApi } from '../lib/api';

// ---------------------------------------------------------------------------
// Types — mirrors the InventoryEntryOut response from quests_go
// ---------------------------------------------------------------------------
export interface InventoryEntry {
  item_id: string;
  quantity: number;
  acquired_at: string;
  updated_at: string;
  // Joined item definition fields
  name: string;
  description: string;
  image_url: string;
  category: string;
  rarity: string;
  actions: string[];
}

/**
 * Fetch the authenticated user's inventory from the Quests service.
 *
 * Endpoint: GET /quests/inventory/:user_id
 * Auth: users can only view their own inventory.
 */
export function useInventory(userId: string | null | undefined) {
  return useQuery<InventoryEntry[]>({
    queryKey: ['inventory', userId],
    queryFn: async () => {
      if (!userId) return [];
      const res = await questsApi.get(`/quests/inventory/${userId}`);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!userId,
    staleTime: 30_000, // inventory doesn't change often — 30s cache
  });
}
