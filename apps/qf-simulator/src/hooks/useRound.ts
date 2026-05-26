import { useState, useCallback } from 'react';
import * as api from '../api/client';
import type { Round, RoundStatus } from '../api/client';

export function useRound() {
  const [round, setRound] = useState<Round | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const fetchRound = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getRound();
      setRound(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch round');
    } finally {
      setLoading(false);
    }
  }, []);

  const createRound = useCallback(async (name: string, matchingPool: number, voterBudget: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.createRound({ name, matchingPool, voterBudget });
      setRound(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create round');
    } finally {
      setLoading(false);
    }
  }, []);

  const addProject = useCallback(async (name: string, description: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.addProject({ name, description });
      setRound(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add project');
    } finally {
      setLoading(false);
    }
  }, []);

  const generateCodes = useCallback(async (count: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.generateCodes(count);
      setRound(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate codes');
    } finally {
      setLoading(false);
    }
  }, []);

  const setStatus = useCallback(async (status: RoundStatus) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.setRoundStatus(status);
      setRound(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status');
    } finally {
      setLoading(false);
    }
  }, []);

  const closeRound = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.closeRound();
      setRound(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close round');
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteRound = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await api.deleteRound();
      setRound(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete round');
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    round,
    loading,
    error,
    clearError,
    fetchRound,
    createRound,
    addProject,
    generateCodes,
    setStatus,
    closeRound,
    deleteRound,
  };
}
