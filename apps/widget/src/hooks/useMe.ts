import { useState, useCallback } from 'react';
import { me as apiMe, type User } from '../api/client';

interface UseMeReturn {
  user: User | null;
  loading: boolean;
  error: string | null;
  fetchUser: () => Promise<User | null>;
}

/**
 * Hook for fetching current user data.
 */
export function useMe(): UseMeReturn {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiMe();
      setUser(data);
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch user';
      setError(message);
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { user, loading, error, fetchUser };
}
