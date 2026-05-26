/**
 * CSRF Protection Middleware
 *
 * Implements the Double-Submit Cookie pattern for CSRF protection.
 * This is required because we use cookies for refresh tokens.
 *
 * How it works:
 * 1. Server sets a CSRF token in a non-HttpOnly cookie (readable by JS)
 * 2. Client reads the cookie and includes the token in the X-CSRF-Token header
 * 3. Server verifies that cookie and header values match
 *
 * Security considerations:
 * - The cookie is NOT HttpOnly so JavaScript can read it
 * - The cookie uses __Host- prefix requiring Secure and Path=/
 * - SameSite=Strict provides additional protection
 * - Timing-safe comparison prevents timing attacks
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { authConfig } from '../config/auth.js';

/** CSRF cookie name - uses __Host- prefix in production/staging for security */
export const CSRF_COOKIE_NAME = authConfig.isProduction || authConfig.isStaging
  ? '__Host-csrf'
  : 'csrf';

/** CSRF header name */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Refresh token cookie name - uses __Host- prefix in production/staging */
export const REFRESH_TOKEN_COOKIE_NAME = authConfig.isProduction || authConfig.isStaging
  ? '__Host-refresh_token'
  : 'refresh_token';

/** Cookie options based on environment */
const getCookieOptions = () => {
  const isProduction = authConfig.isProduction;
  const isStaging = authConfig.isStaging;

  return {
    // __Host- prefix requires: Secure, Path=/
    secure: isProduction || isStaging,
    path: '/',
    sameSite: 'Strict' as const,
    // CSRF cookie is NOT HttpOnly - JS needs to read it
    httpOnly: false,
    // 24 hour expiry
    maxAge: 24 * 60 * 60,
  };
};

/**
 * Generate a cryptographically secure CSRF token.
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Parse cookies from request header.
 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};

  return Object.fromEntries(
    cookieHeader.split(';').map((cookie) => {
      const [key, ...valueParts] = cookie.trim().split('=');
      return [key, valueParts.join('=')];
    })
  );
}

/**
 * Validate CSRF token from request.
 * Returns true if valid, false if invalid.
 *
 * Note: In development mode, CSRF validation can be optionally bypassed
 * for easier testing. Set CSRF_DISABLED=true to disable.
 */
export function validateCsrf(request: Request): boolean {
  // Allow bypass in development for testing
  if (authConfig.isDevelopment && process.env['CSRF_DISABLED'] === 'true') {
    return true;
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parseCookies(cookieHeader);

  // In development without __Host- prefix cookie, try regular cookie name
  const cookieNames = authConfig.isDevelopment
    ? [CSRF_COOKIE_NAME, 'csrf']
    : [CSRF_COOKIE_NAME];

  let cookieToken: string | undefined;
  for (const name of cookieNames) {
    if (cookies[name]) {
      cookieToken = cookies[name];
      break;
    }
  }

  const headerToken = request.headers.get(CSRF_HEADER_NAME);

  // Both must exist
  if (!cookieToken || !headerToken) {
    return false;
  }

  // Timing-safe comparison to prevent timing attacks
  try {
    const cookieBuffer = Buffer.from(cookieToken);
    const headerBuffer = Buffer.from(headerToken);

    // Must be same length for timingSafeEqual
    if (cookieBuffer.length !== headerBuffer.length) {
      return false;
    }

    return timingSafeEqual(cookieBuffer, headerBuffer);
  } catch {
    return false;
  }
}

/**
 * Set CSRF cookie on response.
 */
export function setCsrfCookie(res: ServerResponse, token: string): void {
  const options = getCookieOptions();

  // Build cookie string - CSRF_COOKIE_NAME is already environment-aware
  const cookieParts = [
    `${CSRF_COOKIE_NAME}=${token}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`,
    `Max-Age=${options.maxAge}`,
  ];

  if (options.secure) {
    cookieParts.push('Secure');
  }

  // Note: httpOnly is false for CSRF cookies
  // This allows JavaScript to read and include in headers

  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

/**
 * Build Set-Cookie header value for refresh token (HttpOnly).
 */
export function buildRefreshTokenCookie(token: string, maxAgeSeconds: number): string {
  const isProduction = authConfig.isProduction;
  const isStaging = authConfig.isStaging;

  const cookieParts = [
    `${isProduction || isStaging ? '__Host-refresh_token' : 'refresh_token'}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (isProduction || isStaging) {
    cookieParts.push('Secure');
  }

  return cookieParts.join('; ');
}

/**
 * Build Set-Cookie header value to clear refresh token.
 */
export function buildClearRefreshTokenCookie(): string {
  const isProduction = authConfig.isProduction;
  const isStaging = authConfig.isStaging;

  const cookieName = isProduction || isStaging ? '__Host-refresh_token' : 'refresh_token';

  return [
    `${cookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    isProduction || isStaging ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

/**
 * Extract refresh token from request cookies.
 */
export function extractRefreshToken(request: { headers: Headers }): string | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parseCookies(cookieHeader);

  // Try production cookie name first, then development
  return cookies['__Host-refresh_token'] || cookies['refresh_token'] || null;
}
