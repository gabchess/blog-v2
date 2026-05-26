import { useState, useEffect, useCallback, useRef } from 'react';
import { getTokenExpiry, refresh } from '../api/client';

interface TokenTimerState {
  secondsRemaining: number | null;
  isRefreshing: boolean;
}

/** Hook to track JWT expiry and auto-refresh 1 minute before expiry. */
export function useTokenTimer(onSessionExpired: () => void) {
  const [state, setState] = useState<TokenTimerState>({
    secondsRemaining: null,
    isRefreshing: false
  });

  // Use ref to track refresh status to avoid stale closure issues
  const isRefreshingRef = useRef(false);

  const doRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setState(s => ({ ...s, isRefreshing: true }));
    try {
      await refresh();
    } catch {
      onSessionExpired();
    } finally {
      isRefreshingRef.current = false;
      setState(s => ({ ...s, isRefreshing: false }));
    }
  }, [onSessionExpired]);

  useEffect(() => {
    const interval = setInterval(() => {
      const expiry = getTokenExpiry();
      if (!expiry) {
        setState({ secondsRemaining: null, isRefreshing: false });
        return;
      }

      const remaining = Math.floor((expiry - Date.now()) / 1000);
      setState(s => ({ ...s, secondsRemaining: remaining }));

      // Auto-refresh 60 seconds before expiry
      if (remaining <= 60 && remaining > 0 && !isRefreshingRef.current) {
        doRefresh();
      }

      if (remaining <= 0) {
        onSessionExpired();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [doRefresh, onSessionExpired]);

  return state;
}
