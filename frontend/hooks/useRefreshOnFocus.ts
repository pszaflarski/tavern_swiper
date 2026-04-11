import React from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * A utility hook that triggers a refetch function whenever the screen gains focus.
 * This is useful for ensuring data freshness as users navigate between tabs.
 * 
 * @param refetch - The refetch function from a TanStack Query hook.
 * @param enabled - Whether the refresh logic is enabled.
 */
export function useRefreshOnFocus(refetch: () => void, enabled: boolean = true) {
  const isFirstMount = React.useRef(true);

  useFocusEffect(
    React.useCallback(() => {
      // In non-test environments, skip the refetch on initial mount to avoid
      // double-fetching (once by the query, once by the focus effect).
      const shouldSkip = isFirstMount.current && process.env.NODE_ENV !== 'test';
      
      if (!shouldSkip && enabled) {
        refetch();
      }
      isFirstMount.current = false;
    }, [refetch, enabled])
  );
}
