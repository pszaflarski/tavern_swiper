import { useQuery } from '@tanstack/react-query';
import { discoveryApi } from '../lib/api';

interface DiscoveryProfile {
  profile_id: string;
  display_name: string;
  tagline?: string;
  character_class?: string;
  realm?: string;
  image_url?: string;
  talents: string[];
}

interface FeedResponse {
  profiles: DiscoveryProfile[];
}

export function useDiscovery(profileId: string | undefined) {
  return useQuery<FeedResponse>({
    queryKey: ['discovery', 'feed', profileId],
    queryFn: async () => {
      const res = await discoveryApi.get(`/discovery/feed/${profileId}`);
      return res.data;
    },
    enabled: !!profileId,
    staleTime: 1000 * 60,  // 1 min — feed is relatively stable
  });
}
