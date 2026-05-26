const API_BASE = '/api';

// Token storage in memory (secure - not localStorage)
let accessToken: string | null = null;
export const getAccessToken = (): string | null => accessToken;
export const setAccessToken = (token: string): void => { accessToken = token; };
export const clearAccessToken = (): void => { accessToken = null; };

/**
 * Get token expiry time in milliseconds since epoch.
 * Returns null if no token or token is malformed.
 */
export function getTokenExpiry(): number | null {
  if (!accessToken) return null;
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1]!));
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

/**
 * Refresh the access token using the refresh token cookie.
 */
export async function refresh(): Promise<string> {
  const result = await apiFetch<{ accessToken: string }>('/auth/refresh', { method: 'POST' });
  setAccessToken(result.accessToken);
  return result.accessToken;
}

// Types matching backend state
export interface Project {
  id: string;
  name: string;
  description: string;
}

export interface VoterCode {
  code: string;
  used: boolean;
}

export type RoundStatus = 'setup' | 'voting' | 'closed';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface ProjectResult {
  projectId: string;
  projectName: string;
  directContributions: number;
  rawMatch: number;
  scaledMatch: number;
  total: number;
}

export interface CLRResults {
  projects: ProjectResult[];
  totalRawMatch: number;
  scalingFactor: number;
  matchingPoolUsed: number;
}

export interface Round {
  id: string;
  name: string;
  matchingPool: number;
  voterBudget: number;
  status: RoundStatus;
  projects: Project[];
  voterCodes: VoterCode[];
  votes: Array<{ voterCode: string; allocations: Record<string, number> }>;
  results?: CLRResults;
}

export interface RoundSummary {
  id: string;
  name: string;
  status: RoundStatus;
  matchingPool: number;
  voterBudget: number;
  projectCount: number;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: 'include', // Include cookies for refresh token
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `Request failed (${response.status})` }));
    throw new Error(error.error ?? 'Request failed');
  }
  const data = await response.json();
  return data.data ?? data; // Handle both wrapped and unwrapped responses
}

// Admin endpoints
export const createRound = (input: { name: string; matchingPool: number; voterBudget: number }) =>
  apiFetch<Round>('/qf/rounds', { method: 'POST', body: JSON.stringify(input) });

export const getRound = () =>
  apiFetch<Round>('/qf/rounds/current');

export const getRoundById = (roundId: string) =>
  apiFetch<Round>(`/qf/rounds/${roundId}`);

export const getActiveRounds = () =>
  apiFetch<RoundSummary[]>('/qf/rounds/active');

export const addProject = (input: { name: string; description: string }) =>
  apiFetch<Round>('/qf/rounds/current/projects', { method: 'POST', body: JSON.stringify(input) });

export const generateCodes = (count: number) =>
  apiFetch<Round>('/qf/rounds/current/codes', { method: 'POST', body: JSON.stringify({ count }) });

export const setRoundStatus = (status: RoundStatus) =>
  apiFetch<Round>('/qf/rounds/current/status', { method: 'POST', body: JSON.stringify({ status }) });

export const closeRound = () =>
  apiFetch<Round>('/qf/rounds/current/close', { method: 'POST' });

export const deleteRound = () =>
  apiFetch<{ deleted: boolean }>('/qf/rounds/current', { method: 'DELETE' });

// Voting endpoints
export const submitVote = (voterCode: string, allocations: Record<string, number>) =>
  apiFetch<Round>('/qf/rounds/current/votes', { method: 'POST', body: JSON.stringify({ voterCode, allocations }) });

export const previewVote = (allocations: Record<string, number>) =>
  apiFetch<CLRResults>('/qf/rounds/current/preview', { method: 'POST', body: JSON.stringify({ allocations }) });

// Auth endpoints
export async function signup(email: string, password: string, name: string): Promise<AuthResponse> {
  const result = await apiFetch<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
  setAccessToken(result.accessToken);
  return result;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const result = await apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(result.accessToken);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' });
  } finally {
    clearAccessToken();
  }
}
