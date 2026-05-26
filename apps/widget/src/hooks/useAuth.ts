import { useState, useCallback } from 'react';
import {
  signup as apiSignup,
  login as apiLogin,
  logout as apiLogout,
  refresh as apiRefresh,
  type User,
  type AuthResponse,
} from '../api/client';

interface UseAuthReturn {
  signup: (email: string, password: string, name: string) => Promise<AuthResponse>;
  login: (email: string, password: string) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  refresh: () => Promise<string>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Hook for authentication operations.
 * Wraps API client with loading and error state.
 */
export function useAuth(): UseAuthReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const signup = useCallback(async (email: string, password: string, name: string) => {
    setLoading(true);
    setError(null);
    try {
      return await apiSignup(email, password, name);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signup failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      return await apiLogin(email, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await apiLogout();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Logout failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      return await apiRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token refresh failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { signup, login, logout, refresh, loading, error, clearError };
}
