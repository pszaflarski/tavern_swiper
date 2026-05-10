import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDiscoveryFeed, Profile } from '../../hooks/useProfiles';
import { useSwipe } from '../../hooks/useSwipe';
import { useMatch } from '../../context/MatchContext';
import { DISCOVERY } from '../../constants';

export function useDiscoveryDeck(activeProfileId: string | null | undefined, isAuthenticated: boolean) {
  const swipeMutation = useSwipe();
  const { showMatch } = useMatch();
  const queryClient = useQueryClient();

  const [deck, setDeck] = useState<Profile[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  
  const { WATERMARK, MAX_STALE_FETCHES, BACKOFF_SHORT_MS, BACKOFF_LONG_MS, RECOVERY_MS, LOAD_TIMEOUT_MS } = DISCOVERY;

  const staleFetchCountRef = useRef(0);
  const [isBackingOff, setIsBackingOff] = useState(false);
  const deckRef = useRef<Profile[]>([]);

  // Keep ref in sync with latest deck state
  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  const { data: batch, isFetching, refetch: refetchDiscovery, dataUpdatedAt } = useDiscoveryFeed(activeProfileId ?? undefined, isAuthenticated, DISCOVERY.BATCH_SIZE);
  
  const isInitialLoad = !deck.length && isFetching;

  // Reset deck when current profile changes
  useEffect(() => {
    setDeck([]);
    setCurrentIndex(0);
    setExhausted(false);
  }, [activeProfileId]);

  // Detect when the realm is empty (API returned nothing)
  useEffect(() => {
    if (batch && batch.length === 0 && !isFetching) {
      setExhausted(true);
    }
  }, [batch, isFetching]);

  // Loading timeout effect
  useEffect(() => {
    if (isInitialLoad) {
      const timer = setTimeout(() => setLoadTimedOut(true), LOAD_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }
    setLoadTimedOut(false);
  }, [isInitialLoad]);

  // Append new batches to our local deck with deduplication.
  // We use dataUpdatedAt to ensure this effect runs every time a fetch finishes,
  // even if the data is identical (fixing the referential caching loop).
  useEffect(() => {
    if (batch && batch.length > 0) {
      // Use ref to avoid stale closure of 'deck' without triggering unnecessary effect runs
      const existingIds = new Set(
        (deckRef.current || [])
          .filter(p => p && p.profile_id)
          .map(p => p.profile_id)
      );
      const newUnique = (batch || []).filter(p => p && p.profile_id && !existingIds.has(p.profile_id));
      const isUseless = deckRef.current.length > 0 && newUnique.length === 0;

      if (isUseless) {
        const nextCount = staleFetchCountRef.current + 1;
        staleFetchCountRef.current = nextCount;
        
        if (nextCount >= MAX_STALE_FETCHES) {
          setExhausted(true);
          setIsBackingOff(false);
          // Auto-recover after cooldown to catch newly-added profiles
          setTimeout(() => {
            setExhausted(false);
            staleFetchCountRef.current = 0;
          }, RECOVERY_MS);
        } else {
          setIsBackingOff(true);
          const delay = nextCount <= 2 ? BACKOFF_SHORT_MS : BACKOFF_LONG_MS;
          setTimeout(() => setIsBackingOff(false), delay);
        }
      } else {
        // We found new heroes! Reset backoff and add them.
        staleFetchCountRef.current = 0;
        setIsBackingOff(false);
        
        if (newUnique.length > 0) {
          setDeck(prev => prev.length === 0 ? newUnique : [...prev, ...newUnique]);
        }
      }
    }
  }, [batch, activeProfileId, dataUpdatedAt]);

  const advanceIndex = () => {
    setCurrentIndex(prev => prev + 1);
  };

  const currentProfile = deck[currentIndex];

  const handleSwipeLeft = (id: string) => {
    if (!activeProfileId) return;
    swipeMutation.mutate({ swiperProfileId: activeProfileId, swipedProfileId: id, direction: 'left' });
    advanceIndex();
    setShowDetails(false);
  };

  const handleSwipeRight = (id: string) => {
    if (!activeProfileId) return;
    swipeMutation.mutate(
      { swiperProfileId: activeProfileId, swipedProfileId: id, direction: 'right' },
      {
        onSuccess: (data) => {
          if (data.match_id) {
            const swipedProfile = deck.find(p => p.profile_id === id);
            if (swipedProfile) {
              showMatch({
                profile_id: swipedProfile.profile_id,
                display_name: swipedProfile.display_name,
                image_url: swipedProfile.image_urls?.[0] || '',
              });
            }
          }
        },
      }
    );
    advanceIndex();
    setShowDetails(false);
  };

  // Watermark trigger: if we're running low on cards, summon more heroes in the background.
  // Added isBackingOff check to prevent spamming the API when we know the realm is quiet.
  useEffect(() => {
    const isRunningLow = deck.length > 0 && deck.length - currentIndex <= WATERMARK;
    if (isRunningLow && !isFetching && !exhausted && !isBackingOff) {
      refetchDiscovery();
    }
  }, [currentIndex, deck.length, isFetching, refetchDiscovery, exhausted, isBackingOff]);

  const handleRecast = () => {
    // Full reset: clear local state and all related caches
    setDeck([]);
    setCurrentIndex(0);
    setExhausted(false);
    staleFetchCountRef.current = 0;
    setIsBackingOff(false);
    queryClient.invalidateQueries({ queryKey: ['discovery'] });
    queryClient.invalidateQueries({ queryKey: ['profiles', 'me', 'active'] });
    queryClient.invalidateQueries({ queryKey: ['matches'] });
    refetchDiscovery();
  };

  return {
    deck,
    currentIndex,
    currentProfile,
    showDetails,
    setShowDetails,
    exhausted,
    loadTimedOut,
    setLoadTimedOut,
    isInitialLoad,
    isFetching,
    refetchDiscovery,
    handleSwipeLeft,
    handleSwipeRight,
    handleRecast,
    swipeError: swipeMutation.isError
  };
}
