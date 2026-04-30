import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  match_id?: string | null;
}

export function useSwipe() {
  const queryClient = useQueryClient();

  return useMutation<SwipeResult, Error, { swiperProfileId: string; swipedProfileId: string; direction: Direction }>({
    mutationFn: async ({ swiperProfileId, swipedProfileId, direction }) => {
      const res = await swipesApi.post('/discovery/swipe/', {
        swiper_profile_id: swiperProfileId,
        swiped_profile_id: swipedProfileId,
        direction,
      } satisfies SwipePayload);
      return res.data;
    },
    onSuccess: (data, variables) => {
      // If a mutual match was detected, invalidate related caches
      // so it appears immediately on the messages tab.
      if (data.match_id) {
         console.log('Match detected in hook!', data.match_id);
         queryClient.invalidateQueries({ queryKey: ['matches'] });
         queryClient.invalidateQueries({ queryKey: ['conversations'] });
      }
    },
    onError: (error, variables) => {
      console.error('Swipe failed:', {
        error: error.message,
        swiper: variables.swiperProfileId,
        swiped: variables.swipedProfileId,
        direction: variables.direction,
      });
    },
  });
}
