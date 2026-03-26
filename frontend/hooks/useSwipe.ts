import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { swipesApi } from '../lib/api';

type Direction = 'left' | 'right';

interface SwipePayload {
  swiper_profile_id: string;
  swiped_profile_id: string;
  direction: Direction;
}

interface SwipeResult {
  swipe_id: string;
  swiper_profile_id: string;
  swiped_profile_id: string;
  direction: Direction;
  created_at: string;
}

export interface MatchOut {
  match_id: string;
  profile_id_a: string;
  profile_id_b: string;
  created_at: string;
}

export function useSwipe(swiperProfileId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<SwipeResult, Error, { swipedProfileId: string; direction: Direction }>({
    mutationFn: async ({ swipedProfileId, direction }) => {
      const res = await swipesApi.post('/swipes/', {
        swiper_profile_id: swiperProfileId ?? '',
        swiped_profile_id: swipedProfileId,
        direction,
      } satisfies SwipePayload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery', 'feed', swiperProfileId] });
      queryClient.invalidateQueries({ queryKey: ['swipes', 'matches', swiperProfileId] });
    },
  });
}

export function useMatches(profileId: string | undefined) {
  return useQuery<MatchOut[]>({
    queryKey: ['swipes', 'matches', profileId],
    queryFn: async () => {
      const res = await swipesApi.get(`/swipes/matches/${profileId}`);
      return res.data;
    },
    enabled: !!profileId,
  });
}
