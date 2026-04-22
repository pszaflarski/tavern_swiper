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
      // If a mutual match was detected, trigger the splash screen!
      if (data.match_id) {
         // Note: The UI layer (TavernScreen) is responsible for providing the full profile
         // to showMatch, but we could also emit a global event or just let the mutation caller handle it.
         console.log('Match detected in hook!', data.match_id);
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
