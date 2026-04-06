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
}

export function useSwipe() {
  const queryClient = useQueryClient();

  return useMutation<SwipeResult, Error, { swiperProfileId: string; swipedProfileId: string; direction: Direction }>({
    mutationFn: async ({ swiperProfileId, swipedProfileId, direction }) => {
      const res = await swipesApi.post('/swipes/', {
        swiper_profile_id: swiperProfileId,
        swiped_profile_id: swipedProfileId,
        direction,
      } satisfies SwipePayload);
      return res.data;
    },
    onSuccess: (_, variables) => {
      // Swiping actions are recorded on backend, but we don't need to force a full UI refresh
      // of the current deck to remain stable.
    },
  });
}
