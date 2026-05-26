import { createClient, cacheExchange, fetchExchange } from 'urql';

// Token storage keys
const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

/**
 * Get access token from localStorage.
 */
export const getAccessToken = (): string | null => localStorage.getItem(ACCESS_TOKEN_KEY);

/**
 * Get refresh token from localStorage.
 */
export const getRefreshToken = (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY);

/**
 * Store tokens in localStorage.
 */
export const setTokens = (accessToken: string, refreshToken: string): void => {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
};

/**
 * Clear tokens from localStorage.
 */
export const clearTokens = (): void => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
};

/**
 * URQL client with auth header.
 */
export const client = createClient({
  url: import.meta.env['VITE_GRAPHQL_URL'] || 'http://localhost:4001/graphql',
  exchanges: [cacheExchange, fetchExchange],
  fetchOptions: () => {
    const token = getAccessToken();
    return {
      headers: {
        authorization: token ? `Bearer ${token}` : '',
      },
    };
  },
});
