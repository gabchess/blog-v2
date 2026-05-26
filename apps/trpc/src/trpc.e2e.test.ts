/**
 * tRPC End-to-End Tests
 *
 * Tests against real MongoDB - run with: pnpm test:db
 * Requires DATABASE_URL environment variable.
 *
 * These tests use actual HTTP requests (like GraphQL E2E tests)
 * to properly test cookies, headers, and the full request/response cycle.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHTTPHandler } from '@trpc/server/adapters/standalone';
import bcrypt from 'bcrypt';
import { prisma } from '@octant/db';
import { appRouter } from './routers/index.js';
import { createContext } from './trpc.js';
import {
  setCsrfCookie,
  generateCsrfToken,
  parseCookies,
  validateCsrf,
  CSRF_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_NAME,
} from './middleware/csrf.js';
import { hashToken, lockoutConfig } from './config/auth.js';

// Unique prefix for this test run
const TEST_PREFIX = `test-trpc-${Date.now()}`;

// Test server port
const TEST_PORT = 14002;

// Create tRPC HTTP handler
const handler = createHTTPHandler({
  router: appRouter,
  createContext,
});

// Create test server
let server: Server;

// Cookie jar for testing (simulates browser cookie storage)
let cookieJar: Map<string, string> = new Map();

function clearCookies() {
  cookieJar.clear();
}

function parseCookieHeader(setCookieHeaders: string[]): void {
  for (const header of setCookieHeaders) {
    const cookie = header.split(';')[0];
    if (!cookie) continue;
    const [name, value] = cookie.split('=');
    if (name && value !== undefined) {
      // Handle cookie deletion (empty value with Max-Age=0)
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

/**
 * Make a tRPC request to the test server.
 * Uses POST for mutations (with input) and GET for queries (without input).
 */
async function trpcRequest<T>(
  procedure: string,
  input?: unknown,
  options: { accessToken?: string; method?: 'GET' | 'POST' } = {}
): Promise<{ result?: T; error?: { message: string; code: string } }> {
  const headers: Record<string, string> = {};

  // Include cookies
  const cookieHeader = getCookieHeader();
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  // Include CSRF token for mutations
  const csrfToken = cookieJar.get(CSRF_COOKIE_NAME);
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  // Include access token if provided
  if (options.accessToken) {
    headers['Authorization'] = `Bearer ${options.accessToken}`;
  }

  // Determine HTTP method - mutations use POST, queries use GET
  const method = options.method ?? (input !== undefined ? 'POST' : 'GET');

  let url = `http://localhost:${TEST_PORT}/${procedure}`;
  let body: string | undefined;

  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(input !== undefined ? input : {});
  } else if (input !== undefined) {
    // For GET with input, encode as query param
    url += `?input=${encodeURIComponent(JSON.stringify(input))}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body,
  });

  // Capture Set-Cookie headers
  const setCookieHeaders = response.headers.getSetCookie?.() || [];
  if (setCookieHeaders.length > 0) {
    parseCookieHeader(setCookieHeaders);
  }

  const json = await response.json() as {
    result?: { data: T };
    error?: {
      message: string;
      code: number;
      data?: {
        code: string;
        httpStatus: number;
        path: string;
      };
      json?: {
        message: string;
        data: { code: string };
      };
    };
  };

  if (json.error) {
    // Handle different tRPC error formats
    const message = json.error.json?.message ?? json.error.message ?? 'Unknown error';
    const code = json.error.json?.data?.code ?? json.error.data?.code ?? 'INTERNAL_SERVER_ERROR';
    return { error: { message, code } };
  }

  return { result: json.result?.data };
}

/**
 * Helper to create a test user directly in database.
 */
async function createTestUser(emailSuffix: string, password = 'securePassword123!') {
  const email = `${TEST_PREFIX}-${emailSuffix}@example.com`;
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      name: 'Test User',
      passwordHash,
    },
  });

  return { user, email, password };
}

/**
 * Helper to create a session for a user.
 */
async function createTestSession(userId: string) {
  return prisma.session.create({
    data: {
      userId,
      tokenHash: `test-hash-${Date.now()}-${Math.random()}`,
      tokenFamily: `test-family-${Date.now()}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    },
  });
}

describe('tRPC E2E Tests', () => {
  // Start server before tests
  beforeAll(async () => {
    server = createServer((req, res) => {
      // Set CSRF cookie if not present (using same cookie name as production code)
      const cookies = parseCookies(req.headers.cookie);
      if (!cookies[CSRF_COOKIE_NAME]) {
        const token = generateCsrfToken();
        setCsrfCookie(res, token);
      }

      // Set CORS headers for tests
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Validate CSRF for state-changing requests (POST/PUT/PATCH/DELETE)
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
        if (!validateCsrf(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: 'CSRF validation failed',
              code: 'FORBIDDEN',
            },
          }));
          return;
        }
      }

      handler(req, res);
    });

    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT, resolve);
    });

    // Initialize CSRF cookie by making a preflight request
    const response = await fetch(`http://localhost:${TEST_PORT}/`, {
      method: 'OPTIONS',
    });
    const setCookieHeaders = response.headers.getSetCookie?.() || [];
    parseCookieHeader(setCookieHeaders);
  });

  afterAll(async () => {
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

    // Close server
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('Auth Router', () => {
    const authTestEmail = `${TEST_PREFIX}-auth@example.com`;
    let accessToken: string;

    describe('signup', () => {
      it('signs up a new user and sets HttpOnly refresh token cookie', async () => {
        clearCookies();

        // Get CSRF cookie first
        const csrfResponse = await fetch(`http://localhost:${TEST_PORT}/`, { method: 'OPTIONS' });
        parseCookieHeader(csrfResponse.headers.getSetCookie?.() || []);

        const { result, error } = await trpcRequest<{
          accessToken: string;
          refreshToken: string | null;
          user: { id: string; email: string; name: string };
        }>('auth.signup', {
          email: authTestEmail,
          name: 'Test User',
          password: 'securePassword123!',
        });

        expect(error).toBeUndefined();
        expect(result).toBeDefined();
        expect(result!.accessToken).toBeDefined();
        expect(result!.refreshToken).toBeNull(); // Now sent via cookie
        expect(result!.user.email).toBe(authTestEmail.toLowerCase());
        expect(result!.user.name).toBe('Test User');

        // Verify refresh token cookie was set
        expect(cookieJar.has(REFRESH_TOKEN_COOKIE_NAME)).toBe(true);

        // VERIFY: User was actually created in DB (not just fake response)
        const dbUser = await prisma.user.findUnique({
          where: { email: authTestEmail.toLowerCase() },
        });
        expect(dbUser).not.toBeNull();
        expect(dbUser!.name).toBe('Test User');

        accessToken = result!.accessToken;
      });

      it('rejects duplicate email signup', async () => {
        // VERIFY: Count users before attempt
        const countBefore = await prisma.user.count({
          where: { email: authTestEmail.toLowerCase() },
        });

        const { error } = await trpcRequest('auth.signup', {
          email: authTestEmail,
          name: 'Duplicate User',
          password: 'anotherSecure123!',
        });

        expect(error).toBeDefined();
        expect(error!.message).toContain('Email already registered');

        // VERIFY: No duplicate user was created in DB
        const countAfter = await prisma.user.count({
          where: { email: authTestEmail.toLowerCase() },
        });
        expect(countAfter).toBe(countBefore);
      });

      it('rejects short passwords', async () => {
        const shortPwdEmail = `${TEST_PREFIX}-shortpwd@example.com`;

        const { error } = await trpcRequest('auth.signup', {
          email: shortPwdEmail,
          name: 'Short Pwd User',
          password: 'short123',
        });

        expect(error).toBeDefined();
        expect(error!.message).toContain('12 characters');

        // VERIFY: User was NOT created in DB despite error
        const user = await prisma.user.findUnique({
          where: { email: shortPwdEmail.toLowerCase() },
        });
        expect(user).toBeNull();
      });

      it('rejects common passwords', async () => {
        const blockedPwdEmail = `${TEST_PREFIX}-blockedpwd@example.com`;

        const { error } = await trpcRequest('auth.signup', {
          email: blockedPwdEmail,
          name: 'Blocked Pwd User',
          password: 'password12345',
        });

        expect(error).toBeDefined();
        expect(error!.message).toContain('too common');

        // VERIFY: User was NOT created in DB despite error
        const user = await prisma.user.findUnique({
          where: { email: blockedPwdEmail.toLowerCase() },
        });
        expect(user).toBeNull();
      });
    });

    describe('login', () => {
      it('logs in an existing user and sets HttpOnly refresh token cookie', async () => {
        clearCookies();

        // Get CSRF cookie first
        const csrfResponse = await fetch(`http://localhost:${TEST_PORT}/`, { method: 'OPTIONS' });
        parseCookieHeader(csrfResponse.headers.getSetCookie?.() || []);

        const { result, error } = await trpcRequest<{
          accessToken: string;
          refreshToken: string | null;
          user: { email: string };
        }>('auth.login', {
          email: authTestEmail,
          password: 'securePassword123!',
        });

        expect(error).toBeUndefined();
        expect(result).toBeDefined();
        expect(result!.accessToken).toBeDefined();
        expect(result!.refreshToken).toBeNull(); // Now sent via cookie
        expect(result!.user.email).toBe(authTestEmail.toLowerCase());

        // Verify refresh token cookie was set
        expect(cookieJar.has(REFRESH_TOKEN_COOKIE_NAME)).toBe(true);

        // VERIFY: Session was actually created in DB (not just fake response)
        const session = await prisma.session.findFirst({
          where: { user: { email: authTestEmail.toLowerCase() } },
          orderBy: { createdAt: 'desc' },
        });
        expect(session).not.toBeNull();
        expect(session!.expiresAt).toBeInstanceOf(Date);

        accessToken = result!.accessToken;
      });

      it('rejects invalid password', async () => {
        // VERIFY: Count sessions before failed login
        const sessionCountBefore = await prisma.session.count({
          where: { user: { email: authTestEmail.toLowerCase() } },
        });

        const { error } = await trpcRequest('auth.login', {
          email: authTestEmail,
          password: 'wrongpassword123',
        });

        expect(error).toBeDefined();
        expect(error!.message).toBe('Invalid email or password');

        // VERIFY: No session was created for failed login
        const sessionCountAfter = await prisma.session.count({
          where: { user: { email: authTestEmail.toLowerCase() } },
        });
        expect(sessionCountAfter).toBe(sessionCountBefore);
      });

      it('rejects non-existent user', async () => {
        const { error } = await trpcRequest('auth.login', {
          email: 'nonexistent@example.com',
          password: 'somepassword123!',
        });

        expect(error).toBeDefined();
        expect(error!.message).toBe('Invalid email or password');
      });
    });

    describe('refresh', () => {
      it('refreshes access token using cookie (token rotation)', async () => {
        // Cookie should already have refresh token from login
        const oldRefreshToken = cookieJar.get(REFRESH_TOKEN_COOKIE_NAME);
        expect(oldRefreshToken).toBeDefined();

        const { result, error } = await trpcRequest<{
          accessToken: string;
          refreshToken: string | null;
          user: { email: string };
        }>('auth.refresh', {});

        expect(error).toBeUndefined();
        expect(result).toBeDefined();
        expect(result!.accessToken).toBeDefined();
        expect(result!.refreshToken).toBeNull(); // Now sent via cookie
        expect(result!.user.email).toBe(authTestEmail.toLowerCase());

        // Verify refresh token was rotated (new cookie value)
        const newRefreshToken = cookieJar.get(REFRESH_TOKEN_COOKIE_NAME);
        expect(newRefreshToken).toBeDefined();
        expect(newRefreshToken).not.toBe(oldRefreshToken);

        // VERIFY: Old token is tracked for reuse detection (previousTokenHash set)
        const session = await prisma.session.findFirst({
          where: { tokenHash: hashToken(newRefreshToken!) },
        });
        expect(session).not.toBeNull();
        expect(session!.previousTokenHash).toBe(hashToken(oldRefreshToken!));

        accessToken = result!.accessToken;
      });

      it('rejects when no refresh token cookie present', async () => {
        clearCookies();

        // Get CSRF cookie
        const csrfResponse = await fetch(`http://localhost:${TEST_PORT}/`, { method: 'OPTIONS' });
        parseCookieHeader(csrfResponse.headers.getSetCookie?.() || []);

        const { error } = await trpcRequest('auth.refresh', {});

        expect(error).toBeDefined();
        expect(error!.message).toBe('Refresh token required');
      });
    });

    describe('logout', () => {
      it('logs out and clears refresh token cookie', async () => {
        // First login to get fresh tokens
        clearCookies();
        const csrfResponse = await fetch(`http://localhost:${TEST_PORT}/`, { method: 'OPTIONS' });
        parseCookieHeader(csrfResponse.headers.getSetCookie?.() || []);

        await trpcRequest('auth.login', {
          email: authTestEmail,
          password: 'securePassword123!',
        });

        // Verify we have refresh token
        expect(cookieJar.has(REFRESH_TOKEN_COOKIE_NAME)).toBe(true);

        // Save the token before logout to verify DB deletion
        const refreshTokenBeforeLogout = cookieJar.get(REFRESH_TOKEN_COOKIE_NAME);
        expect(refreshTokenBeforeLogout).toBeDefined();

        // Verify session exists in DB before logout
        const sessionBeforeLogout = await prisma.session.findUnique({
          where: { tokenHash: hashToken(refreshTokenBeforeLogout!) },
        });
        expect(sessionBeforeLogout).not.toBeNull();

        // Logout
        const { result, error } = await trpcRequest<boolean>('auth.logout', {});

        expect(error).toBeUndefined();
        expect(result).toBe(true);

        // Verify refresh token cookie was cleared
        expect(cookieJar.has(REFRESH_TOKEN_COOKIE_NAME)).toBe(false);

        // CRITICAL: Verify session was deleted from DB
        const sessionAfterLogout = await prisma.session.findUnique({
          where: { tokenHash: hashToken(refreshTokenBeforeLogout!) },
        });
        expect(sessionAfterLogout).toBeNull();

        // Verify token is invalidated - refresh should fail
        // Need to restore cookie temporarily to test
        const { error: refreshError } = await trpcRequest('auth.refresh', {});
        expect(refreshError).toBeDefined();
      });
    });
  });

  describe('User Router', () => {
    let testAccessToken: string;
    const userTestEmail = `${TEST_PREFIX}-user-router@example.com`;
    const userTestPassword = 'securePassword123!';

    beforeAll(async () => {
      // Create test user and login
      clearCookies();
      const csrfResponse = await fetch(`http://localhost:${TEST_PORT}/`, { method: 'OPTIONS' });
      parseCookieHeader(csrfResponse.headers.getSetCookie?.() || []);

      // Signup
      const { result } = await trpcRequest<{ accessToken: string }>('auth.signup', {
        email: userTestEmail,
        name: 'Test User',
        password: userTestPassword,
      });

      testAccessToken = result!.accessToken;
    });

    describe('me', () => {
      it('returns current user profile for authenticated user', async () => {
        const { result, error } = await trpcRequest<{
          id: string;
          email: string;
          name: string;
        }>('user.me', undefined, { accessToken: testAccessToken });

        expect(error).toBeUndefined();
        expect(result).toBeDefined();
        expect(result!.email).toBe(userTestEmail.toLowerCase());
        expect(result!.name).toBe('Test User');
        // Verify passwordHash is NOT exposed
        expect((result as Record<string, unknown>)['passwordHash']).toBeUndefined();
      });

      it('throws UNAUTHORIZED for unauthenticated user', async () => {
        const { error } = await trpcRequest('user.me');

        expect(error).toBeDefined();
        expect(error!.code).toBe('UNAUTHORIZED');
      });
    });

    describe('update', () => {
      it('updates user profile', async () => {
        const { result, error } = await trpcRequest<{
          name: string;
          email: string;
        }>('user.update', { name: 'Updated Test User' }, { accessToken: testAccessToken });

        expect(error).toBeUndefined();
        expect(result).toBeDefined();
        expect(result!.name).toBe('Updated Test User');
        expect(result!.email).toBe(userTestEmail.toLowerCase());

        // VERIFY: DB was actually updated (not just response fabricated)
        const dbUser = await prisma.user.findUnique({
          where: { email: userTestEmail.toLowerCase() },
        });
        expect(dbUser).not.toBeNull();
        expect(dbUser!.name).toBe('Updated Test User');
      });

      it('throws UNAUTHORIZED for unauthenticated user', async () => {
        // Capture user state before attack
        const userBefore = await prisma.user.findUnique({
          where: { email: userTestEmail.toLowerCase() },
        });

        const { error } = await trpcRequest('user.update', { name: 'Hacker' });

        expect(error).toBeDefined();
        expect(error!.code).toBe('UNAUTHORIZED');

        // VERIFY: User data was NOT modified despite attempt
        const userAfter = await prisma.user.findUnique({
          where: { email: userTestEmail.toLowerCase() },
        });
        expect(userAfter!.name).toBe(userBefore!.name);
      });
    });

    describe('changePassword', () => {
      it('rejects incorrect current password', async () => {
        // Capture password hash before attempt
        const userBefore = await prisma.user.findUnique({
          where: { email: userTestEmail.toLowerCase() },
        });

        const { error } = await trpcRequest(
          'user.changePassword',
          { currentPassword: 'wrongpassword', newPassword: 'newPassword123!' },
          { accessToken: testAccessToken }
        );

        expect(error).toBeDefined();
        expect(error!.message).toContain('Current password is incorrect');

        // VERIFY: Password was NOT changed in DB
        const userAfter = await prisma.user.findUnique({
          where: { email: userTestEmail.toLowerCase() },
        });
        expect(userAfter!.passwordHash).toBe(userBefore!.passwordHash);
      });

      it('changes password with correct current password', async () => {
        const { result, error } = await trpcRequest<boolean>(
          'user.changePassword',
          { currentPassword: userTestPassword, newPassword: 'newSecurePassword456!' },
          { accessToken: testAccessToken }
        );

        expect(error).toBeUndefined();
        expect(result).toBe(true);

        // Verify can login with new password
        clearCookies();
        const csrfResponse = await fetch(`http://localhost:${TEST_PORT}/`, { method: 'OPTIONS' });
        parseCookieHeader(csrfResponse.headers.getSetCookie?.() || []);

        const { result: loginResult, error: loginError } = await trpcRequest<{ accessToken: string }>(
          'auth.login',
          { email: userTestEmail, password: 'newSecurePassword456!' }
        );

        expect(loginError).toBeUndefined();
        expect(loginResult!.accessToken).toBeDefined();

        // CRITICAL: Verify old password no longer works
        clearCookies();
        const csrfResponse2 = await fetch(`http://localhost:${TEST_PORT}/`, { method: 'OPTIONS' });
        parseCookieHeader(csrfResponse2.headers.getSetCookie?.() || []);

        const { error: oldPasswordError } = await trpcRequest(
          'auth.login',
          { email: userTestEmail, password: userTestPassword }
        );

        expect(oldPasswordError).toBeDefined();
        expect(oldPasswordError!.code).toBe('UNAUTHORIZED');
      });
    });
  });

  describe('Session Router', () => {
    let testAccessToken: string;
    let testUserId: string;
    const sessionTestEmail = `${TEST_PREFIX}-session-router@example.com`;

    beforeAll(async () => {
      clearCookies();
      const csrfResponse = await fetch(`http://localhost:${TEST_PORT}/`, { method: 'OPTIONS' });
      parseCookieHeader(csrfResponse.headers.getSetCookie?.() || []);

      const { result } = await trpcRequest<{
        accessToken: string;
        user: { id: string };
      }>('auth.signup', {
        email: sessionTestEmail,
        name: 'Session Test User',
        password: 'securePassword123!',
      });

      testAccessToken = result!.accessToken;
      testUserId = result!.user.id;
    });

    describe('mySessions', () => {
      it('returns user sessions', async () => {
        const { result, error } = await trpcRequest<Array<{
          id: string;
          isCurrent: boolean;
        }>>('session.mySessions', undefined, { accessToken: testAccessToken });

        expect(error).toBeUndefined();
        expect(result).toBeDefined();
        expect(Array.isArray(result)).toBe(true);
        expect(result!.length).toBeGreaterThan(0);

        // Should have a current session
        const currentSession = result!.find(s => s.isCurrent);
        expect(currentSession).toBeDefined();

        // Verify tokenHash is NOT exposed
        expect((result![0] as Record<string, unknown>)['tokenHash']).toBeUndefined();
      });

      it('throws UNAUTHORIZED for unauthenticated user', async () => {
        const { error } = await trpcRequest('session.mySessions');

        expect(error).toBeDefined();
        expect(error!.code).toBe('UNAUTHORIZED');
      });
    });

    describe('revoke', () => {
      it('revokes another session', async () => {
        // Create another session by logging in again
        const loginResult = await trpcRequest<{ accessToken: string }>('auth.login', {
          email: sessionTestEmail,
          password: 'securePassword123!',
        });

        // Get sessions
        const sessionsResult = await trpcRequest<Array<{ id: string; isCurrent: boolean }>>(
          'session.mySessions',
          undefined,
          { accessToken: testAccessToken }
        );

        // Find a non-current session to revoke
        const nonCurrentSession = sessionsResult.result!.find(s => !s.isCurrent);

        // GUARD: Ensure we have a non-current session to test (prevents silent pass)
        expect(nonCurrentSession).toBeDefined();

        const { result, error } = await trpcRequest<boolean>(
          'session.revoke',
          { id: nonCurrentSession!.id },
          { accessToken: testAccessToken }
        );

        expect(error).toBeUndefined();
        expect(result).toBe(true);

        // Verify session was deleted
        const deletedSession = await prisma.session.findUnique({
          where: { id: nonCurrentSession!.id },
        });
        expect(deletedSession).toBeNull();
      });

      it('cannot revoke another user session (IDOR prevention)', async () => {
        // Create another user with a session
        const otherUserData = await createTestUser('other-user-session');
        const otherUserSession = await createTestSession(otherUserData.user.id);

        const { error } = await trpcRequest(
          'session.revoke',
          { id: otherUserSession.id },
          { accessToken: testAccessToken }
        );

        expect(error).toBeDefined();
        expect(error!.message).toContain("Cannot revoke another user's session");

        // CRITICAL: Verify the victim's session was NOT deleted (attack was prevented)
        const sessionAfterAttack = await prisma.session.findUnique({
          where: { id: otherUserSession.id },
        });
        expect(sessionAfterAttack).not.toBeNull();
      });
    });

    describe('revokeAll', () => {
      it('revokes all other sessions', async () => {
        // Create multiple sessions by logging in several times
        for (let i = 0; i < 2; i++) {
          await trpcRequest('auth.login', {
            email: sessionTestEmail,
            password: 'securePassword123!',
          });
        }

        const sessionsBeforeCount = await prisma.session.count({
          where: { userId: testUserId },
        });

        // Ensure we have multiple sessions to test
        expect(sessionsBeforeCount).toBeGreaterThan(1);

        const { result, error } = await trpcRequest<number>(
          'session.revokeAll',
          undefined,
          { accessToken: testAccessToken, method: 'POST' }
        );

        expect(error).toBeUndefined();
        // Should revoke all except current
        expect(result).toBe(sessionsBeforeCount - 1);

        // CRITICAL: Verify DB state - exactly 1 session should remain (the current one)
        const sessionsAfterCount = await prisma.session.count({
          where: { userId: testUserId },
        });
        expect(sessionsAfterCount).toBe(1);
      });
    });
  });

  describe('Rate Limiting', () => {
    it('records login attempts', async () => {
      const email = `${TEST_PREFIX}-ratelimit@example.com`;

      // Make several failed login attempts
      for (let i = 0; i < 3; i++) {
        await trpcRequest('auth.login', {
          email,
          password: 'wrongpassword123',
        });
      }

      // Verify attempts were recorded WITH success: false
      const attempts = await prisma.loginAttempt.findMany({
        where: { email: email.toLowerCase() },
      });

      expect(attempts).toHaveLength(3);
      // VERIFY: All attempts are marked as failed (not successful)
      expect(attempts.every(a => a.success === false)).toBe(true);
    });

    it('BLOCKS login after exceeding lockout threshold (actual blocking)', async () => {
      const email = `${TEST_PREFIX}-lockout-test@example.com`;

      // Directly insert enough failed attempts to exceed lockout threshold
      // This tests the actual blocking mechanism without making 1000+ requests
      const failedAttempts = [];
      for (let i = 0; i < lockoutConfig.thresholdAttempts; i++) {
        failedAttempts.push({
          email: email.toLowerCase(),
          ipAddress: '127.0.0.1',
          success: false,
          createdAt: new Date(),
        });
      }
      await prisma.loginAttempt.createMany({ data: failedAttempts });

      // Verify attempts were created
      const attemptCount = await prisma.loginAttempt.count({
        where: { email: email.toLowerCase() },
      });
      expect(attemptCount).toBe(lockoutConfig.thresholdAttempts);

      // Now try to login - should be BLOCKED
      clearCookies();
      const csrfResponse = await fetch(`http://localhost:${TEST_PORT}/`, { method: 'OPTIONS' });
      parseCookieHeader(csrfResponse.headers.getSetCookie?.() || []);

      const { error } = await trpcRequest('auth.login', {
        email,
        password: 'anypassword123!',
      });

      // CRITICAL: Verify the request was blocked with TOO_MANY_REQUESTS
      expect(error).toBeDefined();
      expect(error!.code).toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('Validation', () => {
    it('rejects invalid email format', async () => {
      const invalidEmail = 'invalid-email';

      const { error } = await trpcRequest('auth.signup', {
        email: invalidEmail,
        name: 'Test',
        password: 'securePassword123!',
      });

      expect(error).toBeDefined();

      // VERIFY: No user was created with invalid email
      const user = await prisma.user.findFirst({
        where: { email: { contains: invalidEmail } },
      });
      expect(user).toBeNull();
    });

    it('rejects empty name', async () => {
      const emptyNameEmail = `${TEST_PREFIX}-emptyname@example.com`;

      const { error } = await trpcRequest('auth.signup', {
        email: emptyNameEmail,
        name: '',
        password: 'securePassword123!',
      });

      expect(error).toBeDefined();

      // VERIFY: No user was created with empty name
      const user = await prisma.user.findUnique({
        where: { email: emptyNameEmail.toLowerCase() },
      });
      expect(user).toBeNull();
    });
  });

  describe('CSRF Protection', () => {
    it('blocks POST requests without CSRF token', async () => {
      // Make request without X-CSRF-Token header
      const response = await fetch(`http://localhost:${TEST_PORT}/auth.login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': getCookieHeader(), // Include cookies but NOT X-CSRF-Token header
        },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      expect(response.status).toBe(403);
      const json = await response.json() as { error: { message: string } };
      expect(json.error.message).toBe('CSRF validation failed');
    });

    it('blocks POST requests with mismatched CSRF token', async () => {
      // Make request with wrong X-CSRF-Token header
      const response = await fetch(`http://localhost:${TEST_PORT}/auth.login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': getCookieHeader(),
          'X-CSRF-Token': 'wrong-token-value', // Wrong token
        },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      expect(response.status).toBe(403);
      const json = await response.json() as { error: { message: string } };
      expect(json.error.message).toBe('CSRF validation failed');
    });

    it('allows POST requests with valid CSRF token', async () => {
      // This is implicitly tested by all other mutation tests
      // But let's be explicit - login should work with proper CSRF
      clearCookies();
      const csrfResponse = await fetch(`http://localhost:${TEST_PORT}/`, { method: 'OPTIONS' });
      parseCookieHeader(csrfResponse.headers.getSetCookie?.() || []);

      const csrfToken = cookieJar.get(CSRF_COOKIE_NAME);
      expect(csrfToken).toBeDefined();

      const response = await fetch(`http://localhost:${TEST_PORT}/auth.login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': getCookieHeader(),
          'X-CSRF-Token': csrfToken!,
        },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'password123!',
        }),
      });

      // Should not be 403 - might be 401 for invalid creds, but not CSRF failure
      expect(response.status).not.toBe(403);
    });

    it('allows GET requests without CSRF token (queries)', async () => {
      // GET requests don't need CSRF protection
      const response = await fetch(`http://localhost:${TEST_PORT}/user.me`, {
        method: 'GET',
        headers: {
          'Cookie': getCookieHeader(), // No X-CSRF-Token
        },
      });

      // Should not be 403 - will be 401 for unauthenticated, but not CSRF failure
      expect(response.status).not.toBe(403);
    });
  });

  describe('Refresh Token Session Tracking', () => {
    it('updates session lastUsedAt on refresh', async () => {
      // Create user and login
      clearCookies();
      const csrfResponse = await fetch(`http://localhost:${TEST_PORT}/`, { method: 'OPTIONS' });
      parseCookieHeader(csrfResponse.headers.getSetCookie?.() || []);

      const email = `${TEST_PREFIX}-refresh-rate@example.com`;
      await trpcRequest('auth.signup', {
        email,
        name: 'Rate Test User',
        password: 'securePassword123!',
      });

      // Get the session to check lastUsedAt
      const sessionBefore = await prisma.session.findFirst({
        where: { user: { email: email.toLowerCase() } },
        orderBy: { createdAt: 'desc' },
      });
      expect(sessionBefore).not.toBeNull();
      const lastUsedBefore = sessionBefore!.lastUsedAt;

      // Small delay to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 100));

      // Refresh token
      await trpcRequest('auth.refresh', {});

      // Check lastUsedAt was updated (rate limiting tracks this)
      const sessionAfter = await prisma.session.findFirst({
        where: { user: { email: email.toLowerCase() } },
        orderBy: { lastUsedAt: 'desc' },
      });

      expect(sessionAfter).not.toBeNull();
      expect(sessionAfter!.lastUsedAt.getTime()).toBeGreaterThan(lastUsedBefore.getTime());
    });
  });
});
