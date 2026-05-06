import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profilesApi } from '../lib/api';

export interface TagData {
  id: string;
  category: string;
  name: string;
  slug: string;
  multi_select: boolean;
  status: string; // "active" | "pending"
  suggested_by?: string;
}

/**
 * Fetch all tags in a given category.
 */
export function useTagsByCategory(category: string, enabled: boolean = true) {
  return useQuery<TagData[]>({
    queryKey: ['tags', 'category', category],
    queryFn: async () => {
      const res = await profilesApi.get(`/profiles/tags/by-category/${category}`);
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: enabled && !!category,
    staleTime: 5 * 60 * 1000, // Tags don't change often
  });
}

/**
 * Search tags by category and name prefix.
 */
export function useSearchTags(category: string, query: string) {
  return useQuery<TagData[]>({
    queryKey: ['tags', 'search', category, query],
    queryFn: async () => {
      const res = await profilesApi.post('/profiles/tags/search', {
        category,
        name: query,
      });
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!category && query.length >= 2,
    staleTime: 30 * 1000,
  });
}

/**
 * Create a tag. For regular users this creates a "pending" tag.
 * Idempotent: if category+name already exists, returns the existing tag.
 */
export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation<TagData, Error, { category: string; name: string }>({
    mutationFn: async ({ category, name }) => {
      const res = await profilesApi.post('/profiles/tags/', { category, name });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tags', 'category', data.category] });
      queryClient.invalidateQueries({ queryKey: ['tags', 'search', data.category] });
    },
  });
}
