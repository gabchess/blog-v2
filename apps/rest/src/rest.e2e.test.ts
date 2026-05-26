/**
 * REST API End-to-End Tests
 *
 * Self-contained tests that start their own server instance.
 * Tests against real PostgreSQL - run with: pnpm test:e2e
 * Requires POSTGRES_URL environment variable.
 *
 * Pattern: apps/trpc/src/trpc.e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { prisma } from '@octant/db-postgres';
import { createApp } from './app.js';

// Unique prefix for this test run to isolate test data
const TEST_PREFIX = `test-rest-${Date.now()}`;

// Test server port (unique to avoid conflicts with dev server)
const TEST_PORT = 14000;
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Test server instance
let server: Server;

// Cookie jar for testing (simulates browser cookie storage)
const cookieJar: Map<string, string> = new Map();

function clearCookies(): void {
  cookieJar.clear();
}

function parseCookieHeader(setCookieHeaders: string[]): void {
  for (const header of setCookieHeaders) {
    const cookie = header.split(';')[0];
    if (!cookie) continue;
    const [name, value] = cookie.split('=');
    if (name && value !== undefined) {
      if (value === '' || header.includes('Max-Age=0')) {
        cookieJar.delete(name.trim());
      } else {
        cookieJar.set(name.trim(), value.trim());
      }
    }
  }
}

function getCookieHeader(): string {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

interface RestResponse<T> {
  data?: T;
  error?: string;
  status: number;
}

/**
 * Make a REST API request with cookie jar support.
 */
async function restRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    accessToken?: string;
  } = {}
): Promise<RestResponse<T>> {
  const headers: Record<string, string> = {};

  // Include cookies
  const cookieHeader = getCookieHeader();
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  // Include CSRF token
  const csrfToken = cookieJar.get('csrf');
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  // Include access token
  if (options.accessToken) {
    headers['Authorization'] = `Bearer ${options.accessToken}`;
  }

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  // Capture Set-Cookie headers
  const setCookieHeaders = response.headers.getSetCookie?.() || [];
  if (setCookieHeaders.length > 0) {
    parseCookieHeader(setCookieHeaders);
  }

  const json = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    return { error: json.error ?? 'Request failed', status: response.status };
  }

  return { data: json as T, status: response.status };
}

/**
 * Fetch CSRF token from health endpoint.
 */
async function fetchCsrfToken(): Promise<void> {
  const response = await fetch(`${BASE_URL}/health`);
  const setCookieHeaders = response.headers.getSetCookie?.() || [];
  parseCookieHeader(setCookieHeaders);
}

describe('REST API E2E Tests', () => {
  beforeAll(async () => {
    // Start the test server (full app with OpenAPI)
    const app = createApp();
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT, () => resolve());
    });

    // Clear any existing test data
    await prisma.loginAttempt.deleteMany({
      where: { email: { contains: TEST_PREFIX } },
    });
    await prisma.session.deleteMany({
      where: { user: { email: { contains: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: TEST_PREFIX } },
    });
  });

  afterAll(async () => {
    // Stop the test server
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    // Clean up all test data with our prefix
    await prisma.loginAttempt.deleteMany({
      where: { email: { contains: TEST_PREFIX } },
    });
    await prisma.session.deleteMany({
      where: { user: { email: { contains: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { email: { contains: TEST_PREFIX } },
    });
    await prisma.$disconnect();
  });

  describe('Health Endpoints', () => {
    it('GET /health returns ok status', async () => {
      const response = await fetch(`${BASE_URL}/health`);
      const data = (await response.json()) as { status: string; timestamp: number };

      expect(response.status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.timestamp).toBeDefined();
    });

    it('GET /ready returns ready when DB is connected', async () => {
      const response = await fetch(`${BASE_URL}/ready`);
      const data = (await response.json()) as { status: string };

      expect(response.status).toBe(200);
      expect(data.status).toBe('ready');
    });
  });

  describe('Auth Endpoints', () => {
    const testEmail = `${TEST_PREFIX}-auth@example.com`;
    let accessToken: string;

    describe('POST /auth/signup', () => {
      beforeAll(async () => {
        clearCookies();
        await fetchCsrfToken();
      });

      it('creates a new user and returns tokens', async () => {
        const { data, error, status } = await restRequest<{
          accessToken: string;
          user: { id: string; email: string; name: string };
        }>('/auth/signup', {
          method: 'POST',
          body: {
            email: testEmail,
            name: 'Test User',
            password: 'securePassword123!',
          },
        });

        expect(error).toBeUndefined();
        expect(status).toBe(201);
        expect(data?.accessToken).toBeDefined();
        expect(data?.user.email).toBe(testEmail.toLowerCase());

        // VERIFY: User created in DB
        const dbUser = await prisma.user.findUnique({
          where: { email: testEmail.toLowerCase() },
        });
        expect(dbUser).not.toBeNull();
        expect(dbUser?.name).toBe('Test User');

        // VERIFY: Session created in DB
        const sessions = await prisma.session.findMany({
          where: { userId: dbUser!.id },
        });
        expect(sessions.length).toBe(1);

        accessToken = data!.accessToken;
      });

      it('rejects duplicate email signup', async () => {
        const { error, status } = await restRequest('/auth/signup', {
          method: 'POST',
          body: {
            email: testEmail,
            name: 'Duplicate User',
            password: 'anotherSecure123!',
          },
        });

        expect(status).toBe(409);
        expect(error).toContain('already registered');
      });

      it('rejects invalid email format', async () => {
        const { error, status } = await restRequest('/auth/signup', {
          method: 'POST',
          body: {
            email: 'not-an-email',
            name: 'Test',
            password: 'securePassword123!',
          },
        });

        expect(status).toBe(400);
        expect(error).toBeDefined();
      });

      it('rejects weak password', async () => {
        const { error, status } = await restRequest('/auth/signup', {
          method: 'POST',
          body: {
            email: `${TEST_PREFIX}-weak@example.com`,
            name: 'Test',
            password: 'short',
          },
        });

        expect(status).toBe(400);
        expect(error).toBeDefined();
      });
    });

    describe('POST /auth/login', () => {
      it('authenticates existing user', async () => {
        const { data, status } = await restRequest<{
          accessToken: string;
          user: { id: string; email: string };
        }>('/auth/login', {
          method: 'POST',
          body: {
            email: testEmail,
            password: 'securePassword123!',
          },
        });

        expect(status).toBe(200);
        expect(data?.accessToken).toBeDefined();
        expect(data?.user.email).toBe(testEmail.toLowerCase());

        // VERIFY: LoginAttempt recorded in DB
        const attempts = await prisma.loginAttempt.findMany({
          where: { email: testEmail.toLowerCase(), success: true },
        });
        expect(attempts.length).toBeGreaterThan(0);

        accessToken = data!.accessToken;
      });

      it('rejects invalid password', async () => {
        const { error, status } = await restRequest('/auth/login', {
          method: 'POST',
          body: {
            email: testEmail,
            password: 'wrongPassword123!',
          },
        });

        expect(status).toBe(401);
        expect(error).toBeDefined();

        // VERIFY: Failed attempt recorded in DB
        const attempts = await prisma.loginAttempt.findMany({
          where: { email: testEmail.toLowerCase(), success: false },
        });
        expect(attempts.length).toBeGreaterThan(0);
      });

      it('rejects non-existent user', async () => {
        const { error, status } = await restRequest('/auth/login', {
          method: 'POST',
          body: {
            email: `${TEST_PREFIX}-nonexistent@example.com`,
            password: 'securePassword123!',
          },
        });

        expect(status).toBe(401);
        expect(error).toBeDefined();
      });
    });

    describe('GET /auth/me', () => {
      it('returns current user with valid token', async () => {
        const { data, status } = await restRequest<{
          id: string;
          email: string;
          name: string;
        }>('/auth/me', {
          accessToken,
        });

        expect(status).toBe(200);
        expect(data?.email).toBe(testEmail.toLowerCase());
        expect(data?.name).toBe('Test User');
      });

      it('rejects request without token', async () => {
        const { status } = await restRequest('/auth/me');
        expect(status).toBe(403);
      });

      it('rejects invalid token', async () => {
        const { status } = await restRequest('/auth/me', {
          accessToken: 'invalid-token',
        });
        expect(status).toBe(403);
      });
    });

    describe('POST /auth/refresh', () => {
      it('rotates refresh token and returns new access token', async () => {
        // Refresh token should be in cookie jar from login
        const { data, status } = await restRequest<{
          accessToken: string;
        }>('/auth/refresh', { method: 'POST' });

        expect(status).toBe(200);
        expect(data?.accessToken).toBeDefined();

        // Access token is a valid JWT
        expect(data?.accessToken).toMatch(/^eyJ/);

        accessToken = data!.accessToken;
      });

      it('rejects when no refresh token cookie', async () => {
        clearCookies();
        await fetchCsrfToken();

        const { status } = await restRequest('/auth/refresh', {
          method: 'POST',
        });

        expect(status).toBe(401);
      });
    });

    describe('POST /auth/logout', () => {
      beforeAll(async () => {
        // Login again to get fresh session
        clearCookies();
        await fetchCsrfToken();
        await restRequest('/auth/login', {
          method: 'POST',
          body: {
            email: testEmail,
            password: 'securePassword123!',
          },
        });
      });

      it('invalidates session and clears cookies', async () => {
        // Count sessions before logout
        const userBefore = await prisma.user.findUnique({
          where: { email: testEmail.toLowerCase() },
          include: { sessions: true },
        });
        const sessionCountBefore = userBefore?.sessions.length ?? 0;

        const { status } = await restRequest<{ success: boolean }>('/auth/logout', {
          method: 'POST',
          accessToken,
        });

        expect(status).toBe(200);

        // VERIFY: Session count decreased in DB
        const userAfter = await prisma.user.findUnique({
          where: { email: testEmail.toLowerCase() },
          include: { sessions: true },
        });

        // After logout, at least one session should have been deleted
        expect(userAfter?.sessions.length).toBeLessThan(sessionCountBefore);
      });

      it('handles logout without session gracefully', async () => {
        clearCookies();
        await fetchCsrfToken();

        const { status } = await restRequest('/auth/logout', {
          method: 'POST',
        });

        expect(status).toBe(200);
      });
    });

    describe('Token Reuse Detection', () => {
      const reuseEmail = `${TEST_PREFIX}-reuse@example.com`;
      let oldRefreshToken: string;

      beforeAll(async () => {
        clearCookies();
        await fetchCsrfToken();

        // Create user and get initial tokens
        await restRequest('/auth/signup', {
          method: 'POST',
          body: {
            email: reuseEmail,
            name: 'Reuse Test User',
            password: 'securePassword123!',
          },
        });

        // Save the current refresh token
        oldRefreshToken = cookieJar.get('refresh_token') ?? '';
        expect(oldRefreshToken).toBeTruthy();
      });

      it('revokes token family on reuse', async () => {
        // First refresh - should succeed and rotate token
        const { status: firstStatus } = await restRequest('/auth/refresh', {
          method: 'POST',
        });
        expect(firstStatus).toBe(200);

        // Get user's token family
        const user = await prisma.user.findUnique({
          where: { email: reuseEmail.toLowerCase() },
          include: { sessions: true },
        });
        const tokenFamily = user?.sessions[0]?.tokenFamily;
        expect(tokenFamily).toBeDefined();

        // Now try to use the OLD refresh token (simulating token theft)
        cookieJar.set('refresh_token', oldRefreshToken);

        const { status: reuseStatus } = await restRequest('/auth/refresh', {
          method: 'POST',
        });
        expect(reuseStatus).toBe(401);

        // VERIFY: Entire token family was revoked
        const sessionsAfterReuse = await prisma.session.findMany({
          where: { tokenFamily },
        });
        expect(sessionsAfterReuse.length).toBe(0);
      });
    });
  });

  describe('OpenAPI Documentation', () => {
    it('GET /api-docs serves Swagger UI', async () => {
      const response = await fetch(`${BASE_URL}/api-docs/`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('swagger');
    });

    it('GET /openapi.json returns OpenAPI spec', async () => {
      const response = await fetch(`${BASE_URL}/openapi.json`);
      const spec = (await response.json()) as { openapi: string; info: { title: string } };

      expect(response.status).toBe(200);
      expect(spec.openapi).toBe('3.1.0');
      expect(spec.info.title).toBe('Octant REST API');
    });
  });
});
