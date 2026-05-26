import { useState, useCallback } from 'react';
import * as api from '../api/client';
import type { CLRResults } from '../api/client';

export function useVoting() {
  const [preview, setPreview] = useState<CLRResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const submitVote = useCallback(async (voterCode: string, allocations: Record<string, number>) => {
    setLoading(true);
    setError(null);
    try {
      await api.submitVote(voterCode, allocations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit vote');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const getPreview = useCallback(async (allocations: Record<string, number>) => {
    setError(null);
    try {
      const data = await api.previewVote(allocations);
      setPreview(data);
    } catch {
      // Don't set error for preview failures - just clear preview
      setPreview(null);
    }
  }, []);

  return {
    preview,
    loading,
    error,
    clearError,
    submitVote,
    getPreview,
  };
}
