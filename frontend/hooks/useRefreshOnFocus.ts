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
  useFocusEffect(
    React.useCallback(() => {
      if (enabled) {
        refetch();
      }
    }, [refetch, enabled])
  );
}
