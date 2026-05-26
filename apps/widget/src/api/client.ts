/** Access token stored in module scope (not localStorage for security) */
let accessToken: string | null = null;

/**
 * Get current access token.
 */
export const getAccessToken = (): string | null => accessToken;

/**
 * Store access token in memory.
 */
export const setAccessToken = (token: string): void => {
  accessToken = token;
};

/**
 * Clear access token from memory.
 */
export const clearAccessToken = (): void => {
  accessToken = null;
};

/**
 * Decode JWT to extract expiry timestamp.
 * Returns null if no token or invalid format.
 */
export function getTokenExpiry(): number | null {
  if (!accessToken) return null;
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]!));
    return payload.exp * 1000; // Convert to milliseconds
  } catch {
    return null;
  }
}

/** Base URL for API calls (proxied via Vite in dev) */
const API_BASE = '/api';

/** User type returned from auth endpoints */
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Auth response from signup/login */
export interface AuthResponse {
  accessToken: string;
  user: User;
}

/** Refresh response */
export interface RefreshResponse {
  accessToken: string;
}

/**
 * Make authenticated API request.
 * Includes credentials for HttpOnly cookie handling.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (accessToken) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include', // Include HttpOnly cookies
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error ?? 'Request failed');
  }

  return response.json();
}

/**
 * Signup with email, password, and name.
 */
export async function signup(
  email: string,
  password: string,
  name: string
): Promise<AuthResponse> {
  const result = await apiFetch<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
  setAccessToken(result.accessToken);
  return result;
}

/**
 * Login with email and password.
 */
export async function login(
  email: string,
  password: string
): Promise<AuthResponse> {
  const result = await apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(result.accessToken);
  return result;
}

/**
 * Logout current session.
 */
export async function logout(): Promise<void> {
  await apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' });
  clearAccessToken();
}

/**
 * Refresh access token using HttpOnly cookie.
 */
export async function refresh(): Promise<string> {
  const result = await apiFetch<RefreshResponse>('/auth/refresh', {
    method: 'POST',
  });
  setAccessToken(result.accessToken);
  return result.accessToken;
}

/**
 * Get current user info.
 */
export async function me(): Promise<User> {
  return apiFetch<User>('/auth/me');
}
