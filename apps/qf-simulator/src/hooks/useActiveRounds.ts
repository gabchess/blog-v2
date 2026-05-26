import { useState, useCallback } from 'react';
import * as api from '../api/client';
import type { RoundSummary } from '../api/client';

export function useActiveRounds() {
  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const fetchActiveRounds = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await api.getActiveRounds();
      setRounds(data);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch active rounds');
      return [];
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  return {
    rounds,
    loading,
    error,
    clearError,
    fetchActiveRounds,
  };
}
