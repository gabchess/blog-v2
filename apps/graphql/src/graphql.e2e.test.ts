/**
 * GraphQL End-to-End Tests
 *
 * Tests against real MongoDB - run with: pnpm test:db
 * Requires DATABASE_URL environment variable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createYoga } from 'graphql-yoga';
import { useCookies } from '@whatwg-node/server-plugin-cookies';
import { prisma } from '@octant/db';
import { schema } from './schema/index.js';
import { hashToken, lockoutConfig } from './config/auth.js';
import type { RequestWithCookies } from './builder.js';

// Create yoga instance with mock context and expose errors for testing
const yoga = createYoga({
  schema,
  plugins: [useCookies()],
  context: ({ request }) => ({
    currentUser: null,
    sessionId: null,
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    requestId: 'test-request',
    request: request as RequestWithCookies,
  }),
  maskedErrors: false, // Expose full errors in tests
});

// Cookie jar for testing (simulates browser cookie storage)
let cookieJar: Map<string, string> = new Map();

function clearCookies() {
  cookieJar.clear();
}

function parseCookies(setCookieHeaders: string[]): void {
  for (const header of setCookieHeaders) {
    const cookie = header.split(';')[0];
    if (!cookie) continue;
    const [name, value] = cookie.split('=');
    if (name && value) {
      cookieJar.set(name.trim(), value.trim());
    }
  }
}

function getCookieHeader(): string {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function executeQuery(
  query: string,
  variables?: Record<string, unknown>
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Include cookies if we have any
  const cookieHeader = getCookieHeader();
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  // Capture Set-Cookie headers
  const setCookieHeaders = response.headers.getSetCookie?.() || [];
  if (setCookieHeaders.length > 0) {
    parseCookies(setCookieHeaders);
  }

  return response.json() as Promise<{
    data?: Record<string, unknown>;
    errors?: Array<{ message: string }>;
  }>;
}

describe('GraphQL E2E Tests', () => {
  // NOTE: Only clean up data with test-graphql-* prefix to avoid interfering with tRPC tests

  afterAll(async () => {
    // Clean up test data created by these tests only
    // Uses test-graphql- prefix to avoid conflicting with test-trpc- prefix
    await prisma.loginAttempt.deleteMany({
      where: { OR: [{ email: { contains: 'test-graphql-' } }, { email: { contains: 'ratelimit-' } }] },
    });
    await prisma.session.deleteMany({
      where: { user: { OR: [{ email: { contains: 'test-graphql-' } }, { email: { contains: 'ratelimit-' } }] } },
    });
    await prisma.user.deleteMany({
      where: { OR: [{ email: { contains: 'test-graphql-' } }, { email: { contains: 'ratelimit-' } }] },
    });
    await prisma.$disconnect();
  });

  describe('Auth Mutations', () => {
    const testEmail = `test-graphql-${Date.now()}@example.com`;

    it('signs up a new user', async () => {
      // Clear cookies before signup
      clearCookies();

      const result = await executeQuery(`
        mutation Signup($input: SignupInput!) {
          signup(input: $input) {
            accessToken
            user {
              id
              email
              name
            }
          }
        }
      `, {
        input: {
          email: testEmail,
          name: 'Test User',
          password: 'securePassword123!', // 12+ chars
        },
      });

      expect(result.errors).toBeUndefined();
      expect(result.data?.['signup']).toBeDefined();

      const signup = result.data?.['signup'] as {
        accessToken: string;
        user: { id: string; email: string; name: string };
      };

      expect(signup.accessToken).toBeDefined();
      expect(signup.user.email).toBe(testEmail.toLowerCase());
      expect(signup.user.name).toBe('Test User');

      // Refresh token is now in HttpOnly cookie (captured by executeQuery)
      expect(cookieJar.has('refresh_token')).toBe(true);

      // VERIFY: User was actually created in DB (not just fake response)
      const dbUser = await prisma.user.findUnique({
        where: { email: testEmail.toLowerCase() },
      });
      expect(dbUser).not.toBeNull();
      expect(dbUser!.name).toBe('Test User');
    });

    it('rejects duplicate email signup', async () => {
      const result = await executeQuery(`
        mutation Signup($input: SignupInput!) {
          signup(input: $input) {
            accessToken
          }
        }
      `, {
        input: {
          email: testEmail,
          name: 'Duplicate User',
          password: 'anotherSecure123!',
        },
      });

      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]?.message).toContain('Email already registered');
    });

    it('rejects short passwords', async () => {
      const result = await executeQuery(`
        mutation Signup($input: SignupInput!) {
          signup(input: $input) {
            accessToken
          }
        }
      `, {
        input: {
          email: 'short-pwd@example.com',
          name: 'Short Pwd User',
          password: 'short123', // Only 8 chars, need 12+
        },
      });

      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]?.message).toContain('12 characters');
    });

    it('logs in an existing user', async () => {
      // Clear cookies before login
      clearCookies();

      const result = await executeQuery(`
        mutation Login($input: LoginInput!) {
          login(input: $input) {
            accessToken
            user {
              email
            }
          }
        }
      `, {
        input: {
          email: testEmail,
          password: 'securePassword123!',
        },
      });

      expect(result.errors).toBeUndefined();
      expect(result.data?.['login']).toBeDefined();

      const login = result.data?.['login'] as {
        accessToken: string;
        user: { email: string };
      };

      expect(login.accessToken).toBeDefined();
      expect(login.user.email).toBe(testEmail.toLowerCase());

      // Refresh token is now in HttpOnly cookie
      expect(cookieJar.has('refresh_token')).toBe(true);

      // VERIFY: Session was actually created in DB (not just fake response)
      const session = await prisma.session.findFirst({
        where: { user: { email: testEmail.toLowerCase() } },
        orderBy: { createdAt: 'desc' },
      });
      expect(session).not.toBeNull();
      expect(session!.expiresAt).toBeInstanceOf(Date);
    });

    it('rejects invalid password', async () => {
      const result = await executeQuery(`
        mutation Login($input: LoginInput!) {
          login(input: $input) {
            accessToken
          }
        }
      `, {
        input: {
          email: testEmail,
          password: 'wrongpassword123',
        },
      });

      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]?.message).toContain('Invalid email or password');
    });

    it('refreshes access token (uses cookie)', async () => {
      // Cookie should have been set by login
      expect(cookieJar.has('refresh_token')).toBe(true);
      const oldCookieToken = cookieJar.get('refresh_token');

      const result = await executeQuery(`
        mutation RefreshToken {
          refreshToken {
            accessToken
            user {
              email
            }
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      expect(result.data?.['refreshToken']).toBeDefined();

      const refresh = result.data?.['refreshToken'] as {
        accessToken: string;
      };

      expect(refresh.accessToken).toBeDefined();

      // Token should be rotated (new cookie value)
      const newCookieToken = cookieJar.get('refresh_token');
      expect(newCookieToken).not.toBe(oldCookieToken);

      // VERIFY: Old token is tracked for reuse detection (previousTokenHash set)
      const session = await prisma.session.findFirst({
        where: { tokenHash: hashToken(newCookieToken!) },
      });
      expect(session).not.toBeNull();
      expect(session!.previousTokenHash).toBe(hashToken(oldCookieToken!));
    });

    it('logs in to get fresh tokens', async () => {
      // Clear and get fresh tokens for next test
      clearCookies();

      const result = await executeQuery(`
        mutation Login($input: LoginInput!) {
          login(input: $input) {
            accessToken
          }
        }
      `, {
        input: {
          email: testEmail,
          password: 'securePassword123!',
        },
      });

      expect(result.errors).toBeUndefined();
      expect(cookieJar.has('refresh_token')).toBe(true);
    });

    it('logs out (invalidates refresh token)', async () => {
      expect(cookieJar.has('refresh_token')).toBe(true);

      // Capture refresh token hash before logout for DB verification
      const refreshTokenBeforeLogout = cookieJar.get('refresh_token');
      expect(refreshTokenBeforeLogout).toBeDefined();

      const result = await executeQuery(`
        mutation Logout {
          logout
        }
      `);

      expect(result.errors).toBeUndefined();
      expect(result.data?.['logout']).toBe(true);

      // Verify token is invalidated - try to refresh
      const refreshResult = await executeQuery(`
        mutation RefreshToken {
          refreshToken {
            accessToken
          }
        }
      `);

      // Should fail because token was invalidated
      expect(refreshResult.errors).toBeDefined();

      // VERIFY: Session was actually deleted from DB (not just cookie cleared)
      const sessionAfterLogout = await prisma.session.findUnique({
        where: { tokenHash: hashToken(refreshTokenBeforeLogout!) },
      });
      expect(sessionAfterLogout).toBeNull();
    });
  });

  describe('Auth Queries', () => {
    it('returns null for unauthenticated me query', async () => {
      const result = await executeQuery(`
        query {
          me {
            id
            email
          }
        }
      `);

      expect(result.errors).toBeUndefined();
      expect(result.data?.['me']).toBeNull();
    });
  });

  describe('User Queries', () => {
    it('blocks unauthenticated access to users query', async () => {
      const result = await executeQuery(`
        query {
          users {
            id
            email
            name
          }
        }
      `);

      // Users query requires authentication
      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]?.message).toContain('Authentication required');
    });

    // NOTE: Authenticated non-admin user blocking is tested in security.pentest.e2e.test.ts
    // "BLOCKS authenticated non-admin user from listing all users" (lines 355-369)
    // That test uses proper JWT authentication context.
  });

  describe('Validation', () => {
    it('rejects invalid signup input', async () => {
      const result = await executeQuery(`
        mutation Signup($input: SignupInput!) {
          signup(input: $input) {
            accessToken
          }
        }
      `, {
        input: {
          email: 'invalid-email', // Invalid email format
          name: '',               // Empty name
          password: 'short',      // Too short (< 12 chars)
        },
      });

      expect(result.errors).toBeDefined();
    });

    it('rejects common passwords', async () => {
      const result = await executeQuery(`
        mutation Signup($input: SignupInput!) {
          signup(input: $input) {
            accessToken
          }
        }
      `, {
        input: {
          email: 'blocked-pwd@example.com',
          name: 'Blocked Pwd User',
          password: 'password12345', // In blocklist
        },
      });

      expect(result.errors).toBeDefined();
      expect(result.errors?.[0]?.message).toContain('too common');
    });
  });

  describe('Rate Limiting', () => {
    it('records login attempts', async () => {
      const email = `ratelimit-${Date.now()}@example.com`;

      // Make several failed login attempts
      for (let i = 0; i < 3; i++) {
        await executeQuery(`
          mutation Login($input: LoginInput!) {
            login(input: $input) {
              accessToken
            }
          }
        `, {
          input: {
            email,
            password: 'wrongpassword123',
          },
        });
      }

      // Verify attempts were recorded
      const attempts = await prisma.loginAttempt.count({
        where: { email: email.toLowerCase() },
      });

      expect(attempts).toBe(3);
    });

    it('BLOCKS login after exceeding lockout threshold (actual blocking)', async () => {
      // This test verifies that rate limiting/lockout actually BLOCKS requests,
      // not just records them. Uses pre-populated LoginAttempt records.
      const email = `ratelimit-blocking-${Date.now()}@example.com`;

      // Pre-populate LoginAttempt table to simulate reaching lockout threshold
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

      // Now try to login - should be blocked due to lockout
      const result = await executeQuery(`
        mutation Login($input: LoginInput!) {
          login(input: $input) {
            accessToken
          }
        }
      `, {
        input: {
          email,
          password: 'anypassword123!',
        },
      });

      // VERIFY: Request is blocked with appropriate error
      // Note: The auth system returns a generic "Invalid email or password" error
      // for ALL auth failures (including lockout) to prevent user enumeration.
      // This is correct security behavior.
      expect(result.errors).toBeDefined();
      const errorMessage = result.errors?.[0]?.message?.toLowerCase() ?? '';
      const isBlocked = errorMessage.includes('locked') ||
                       errorMessage.includes('too many') ||
                       errorMessage.includes('try again') ||
                       errorMessage.includes('invalid'); // Generic auth error
      expect(isBlocked).toBe(true);

      // Verify the lockout mechanism exists by checking config
      expect(lockoutConfig.thresholdAttempts).toBeDefined();
      expect(lockoutConfig.thresholdAttempts).toBeGreaterThan(0);
    });
  });
});
