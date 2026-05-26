/**
 * CSRF Protection Middleware for Express REST API
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
 *
 * @see ADR-205 for full security rationale
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
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

/**
 * Parse cookies from request header string.
 */
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};

  return Object.fromEntries(
    cookieHeader.split(';').map((cookie) => {
      const [key, ...valueParts] = cookie.trim().split('=');
      return [key, valueParts.join('=')];
    })
  );
}

/**
 * Generate a cryptographically secure CSRF token.
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Validate CSRF token from request.
 * Returns true if valid, false if invalid.
 *
 * Note: In development mode, CSRF validation can be optionally bypassed
 * for easier testing. Set CSRF_DISABLED=true to disable.
 */
export function validateCsrf(req: IncomingMessage): boolean {
  // Allow bypass in development for testing
  if (authConfig.isDevelopment && process.env['CSRF_DISABLED'] === 'true') {
    return true;
  }

  const cookieHeader = req.headers.cookie ?? '';
  const cookies = parseCookies(cookieHeader);

  // In development without __Host- prefix cookie, try regular cookie name
  const cookieNames = authConfig.isDevelopment
    ? ['__Host-csrf', 'csrf']
    : [CSRF_COOKIE_NAME];

  let cookieToken: string | undefined;
  for (const name of cookieNames) {
    if (cookies[name]) {
      cookieToken = cookies[name];
      break;
    }
  }

  const headerToken = req.headers[CSRF_HEADER_NAME];
  const headerTokenStr = typeof headerToken === 'string' ? headerToken : null;

  // Both must exist
  if (!cookieToken || !headerTokenStr) {
    return false;
  }

  // Timing-safe comparison to prevent timing attacks
  try {
    const cookieBuffer = Buffer.from(cookieToken);
    const headerBuffer = Buffer.from(headerTokenStr);

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
 * Extract refresh token from request cookies.
 */
export function extractRefreshToken(req: IncomingMessage): string | null {
  const cookies = parseCookies(req.headers.cookie);

  // Try production cookie name first, then development
  return cookies['__Host-refresh_token'] || cookies['refresh_token'] || null;
}

/**
 * Build Set-Cookie header value for CSRF token (NOT HttpOnly - JS needs to read it).
 */
export function buildCsrfCookie(token: string): string {
  const isSecure = authConfig.isProduction || authConfig.isStaging;

  const cookieParts = [
    `${CSRF_COOKIE_NAME}=${token}`,
    'Path=/',
    'SameSite=Strict',
    'Max-Age=86400', // 24 hours
  ];

  if (isSecure) {
    cookieParts.push('Secure');
  }

  // Note: HttpOnly is NOT included - JS needs to read this cookie
  return cookieParts.join('; ');
}

/**
 * Build Set-Cookie header value for refresh token (HttpOnly).
 */
export function buildRefreshTokenCookie(token: string, maxAgeSeconds: number): string {
  const isSecure = authConfig.isProduction || authConfig.isStaging;

  const cookieParts = [
    `${REFRESH_TOKEN_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (isSecure) {
    cookieParts.push('Secure');
  }

  return cookieParts.join('; ');
}

/**
 * Build Set-Cookie header value to clear refresh token.
 */
export function buildClearRefreshTokenCookie(): string {
  const isSecure = authConfig.isProduction || authConfig.isStaging;

  const cookieParts = [
    `${REFRESH_TOKEN_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];

  if (isSecure) {
    cookieParts.push('Secure');
  }

  return cookieParts.join('; ');
}

/**
 * Set a cookie on the response, handling multiple Set-Cookie headers.
 */
export function setCookie(res: ServerResponse, cookieValue: string): void {
  const existing = res.getHeader('Set-Cookie');
  const existingArray = existing
    ? (Array.isArray(existing) ? existing.map(String) : [String(existing)])
    : [];

  res.setHeader('Set-Cookie', [...existingArray, cookieValue]);
}

/**
 * Set the CSRF cookie on the response.
 */
export function setCsrfCookie(res: ServerResponse, token: string): void {
  setCookie(res, buildCsrfCookie(token));
}

/**
 * Set the refresh token cookie on the response.
 */
export function setRefreshTokenCookie(res: ServerResponse, token: string): void {
  const maxAge = authConfig.refreshTokenExpiryDays * 24 * 60 * 60;
  setCookie(res, buildRefreshTokenCookie(token, maxAge));
}

/**
 * Clear the refresh token cookie on the response.
 */
export function clearRefreshTokenCookie(res: ServerResponse): void {
  setCookie(res, buildClearRefreshTokenCookie());
}
