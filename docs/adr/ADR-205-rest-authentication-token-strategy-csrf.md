# ADR-205: REST Security Implementation

## Status
Implemented

## Context

This ADR documents the security implementation for the REST API server, ensuring parity with the GraphQL (ADR-005) and tRPC (ADR-105) security features.

The REST server uses HttpOnly cookies for refresh tokens and implements CSRF protection using the double-submit cookie pattern. All security patterns are identical to GraphQL/tRPC, adapted for Express middleware.

---

## Decision

### 1. HttpOnly Cookies for Refresh Tokens

Refresh tokens are stored in HttpOnly cookies instead of being returned in the response body.

**Why:**
- HttpOnly cookies cannot be accessed by JavaScript, neutralizing XSS attacks
- Automatic handling by the browser reduces client-side complexity
- Consistent with ADR-005/ADR-105 security architecture

**Implementation:**
```typescript
// apps/rest/src/middleware/csrf.ts
export function setRefreshTokenCookie(res: ServerResponse, token: string): void {
  const maxAge = authConfig.refreshTokenExpiryDays * 24 * 60 * 60;
  setCookie(res, buildRefreshTokenCookie(token, maxAge));
}

// Cookie format (production):
// __Host-refresh_token=xyz; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=604800
```

### 2. CSRF Double-Submit Cookie Pattern

CSRF protection is implemented using the double-submit cookie pattern.

**How it works:**
1. Server sets a CSRF token in a non-HttpOnly cookie (readable by JS)
2. Client reads the cookie and includes the token in the `X-CSRF-Token` header
3. Server validates that cookie and header values match

**Why double-submit:**
- Attacker on `evil.com` cannot read cookies from `yourapp.com` (Same-Origin Policy)
- Even if they trigger a request, they cannot set the correct header value
- Timing-safe comparison prevents timing attacks

**Cookie naming:**
- Production/Staging: `__Host-csrf` (with `__Host-` prefix for additional security)
- Development: `csrf` (no prefix, allows HTTP)
- Max-Age: 24 hours (86400 seconds)

**Implementation:**
```typescript
// Client-side (production)
const csrfToken = document.cookie.match(/__Host-csrf=([^;]+)/)?.[1]
  ?? document.cookie.match(/csrf=([^;]+)/)?.[1];

fetch('/auth/logout', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'X-CSRF-Token': csrfToken,
  },
});

// Server-side validation (apps/rest/src/middleware/csrf.ts)
export function validateCsrf(req: IncomingMessage): boolean {
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];

  // Length check + timing-safe comparison
  if (cookieToken.length !== headerToken.length) return false;
  return timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
}
```

### 3. Rate Limiting

Rate limiting is applied to auth endpoints using `express-rate-limit`.

**Configuration (environment-aware):**
```typescript
// apps/rest/src/middleware/rateLimiter.ts

// Login: 5 attempts per 15 minutes
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 5 : 1000,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Signup: 3 attempts per hour
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isProduction ? 3 : 1000,
  message: { error: 'Too many signup attempts. Please try again later.' },
});

// Refresh: 10 attempts per 15 minutes
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 10 : 1000,
  message: { error: 'Too many refresh attempts. Please try again later.' },
});
```

### 4. Account Lockout

Account lockout is implemented after too many failed login attempts.

**Configuration:**
```typescript
// apps/rest/src/config/auth.ts
export const lockoutConfig = {
  thresholdAttempts: 5,     // Lock after 5 failed attempts
  windowMs: 15 * 60 * 1000, // Within 15 minute window
};
```

**Implementation in login route:**
```typescript
// Check for account lockout
const recentFailures = await prisma.loginAttempt.count({
  where: {
    email: normalizedEmail,
    success: false,
    createdAt: { gte: new Date(Date.now() - lockoutConfig.windowMs) },
  },
});

if (recentFailures >= lockoutConfig.thresholdAttempts) {
  auditWarn(AuditEvent.ACCOUNT_LOCKOUT, ...);
  return res.status(429).json({ error: 'Account temporarily locked.' });
}
```

### 5. Token Rotation with Reuse Detection

Refresh tokens are rotated on each use, with reuse detection to prevent token theft.

**How it works:**
1. On refresh, old token hash is stored in `previousTokenHash`
2. New token is generated and returned
3. If old token is reused, entire token family is revoked

**Implementation:**
```typescript
// apps/rest/src/routes/auth.ts - POST /auth/refresh

// Atomic rotation with Prisma transaction
const result = await prisma.$transaction(async (tx) => {
  const session = await tx.session.findUnique({
    where: { tokenHash: oldTokenHash },
  });

  if (!session) {
    // Check for token reuse
    const reuseSession = await tx.session.findFirst({
      where: { previousTokenHash: oldTokenHash },
    });

    if (reuseSession) {
      // TOKEN REUSE DETECTED - Revoke entire family
      await tx.session.deleteMany({
        where: { tokenFamily: reuseSession.tokenFamily },
      });
      auditAlert(AuditEvent.TOKEN_REUSE_DETECTED, ...);
    }
    return null;
  }

  // Rotate token
  await tx.session.update({
    where: { id: session.id },
    data: {
      tokenHash: hashToken(newRefreshToken),
      previousTokenHash: oldTokenHash,
      expiresAt: newExpiresAt,
    },
  });

  return { session, newRefreshToken };
});
```

### 6. Cookie Security Configuration

**Refresh Token Cookie:**

| Environment | Cookie Name | Secure | SameSite | HttpOnly | Max-Age |
|-------------|-------------|--------|----------|----------|---------|
| Production  | `__Host-refresh_token` | Yes | Strict | Yes | 7 days |
| Staging     | `__Host-refresh_token` | Yes | Strict | Yes | 7 days |
| Development | `refresh_token` | No | Strict | Yes | 7 days |

**CSRF Cookie:**

| Environment | Cookie Name | Secure | SameSite | HttpOnly | Max-Age |
|-------------|-------------|--------|----------|----------|---------|
| Production  | `__Host-csrf` | Yes | Strict | No | 24 hours |
| Staging     | `__Host-csrf` | Yes | Strict | No | 24 hours |
| Development | `csrf` | No | Strict | No | 24 hours |

The `__Host-` prefix requires:
- `Secure` attribute (HTTPS only)
- `Path=/` attribute
- No `Domain` attribute

This prevents subdomain attacks and ensures cookies are only sent over secure connections.

---

## Architecture

### Request Flow for Cookie-Based Auth

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Browser                                           │
│                                                                      │
│  1. Login Request                                                    │
│     POST /auth/login                                                 │
│     Body: { email, password }                                        │
│                                                                      │
│  2. Response Sets Cookies:                                           │
│     Set-Cookie: __Host-refresh_token=xyz; HttpOnly; Secure          │
│     Set-Cookie: __Host-csrf=abc123; Secure (NOT HttpOnly)           │
│     Body: { accessToken, user }                                      │
│                                                                      │
│  3. Subsequent Requests:                                             │
│     Authorization: Bearer <accessToken>                              │
│     Cookie: __Host-refresh_token=xyz; __Host-csrf=abc123            │
│                                                                      │
│  4. Refresh Request:                                                 │
│     POST /auth/refresh                                               │
│     Cookie: __Host-refresh_token=xyz; __Host-csrf=abc123            │
│     X-CSRF-Token: abc123                                             │
│                                                                      │
│  5. Logout Request:                                                  │
│     POST /auth/logout                                                │
│     Cookie: __Host-refresh_token=xyz; __Host-csrf=abc123            │
│     X-CSRF-Token: abc123                                             │
│     (Cookies cleared via Max-Age=0)                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## API Changes

### Auth Endpoints

| Endpoint | Method | Request Body | Response | Cookies Set |
|----------|--------|--------------|----------|-------------|
| `/auth/signup` | POST | `{ email, password, name }` | `{ accessToken, user }` | refresh_token, csrf |
| `/auth/login` | POST | `{ email, password }` | `{ accessToken, user }` | refresh_token, csrf |
| `/auth/logout` | POST | (none) | `{ success: true }` | (cleared) |
| `/auth/refresh` | POST | (none - uses cookie) | `{ accessToken }` | refresh_token, csrf |
| `/auth/me` | GET | (none) | `{ id, email, name, ... }` | (none) |

### Cookie Behavior

| Action | refresh_token | csrf |
|--------|---------------|------|
| Signup | Set (new) | Set (new) |
| Login | Set (new) | Set (new) |
| Refresh | Rotated | Rotated |
| Logout | Cleared | (unchanged) |

---

## Security Comparison

| Feature | GraphQL (ADR-005) | tRPC (ADR-105) | REST (ADR-205) |
|---------|-------------------|----------------|----------------|
| **HttpOnly refresh tokens** | Yes | Yes | Yes |
| **CSRF double-submit** | Yes | Yes | Yes |
| **Rate limiting** | Yes | Yes | Yes |
| **Account lockout** | Yes | Yes | Yes |
| **Token rotation** | Yes | Yes | Yes |
| **Reuse detection** | Yes | Yes | Yes |
| **JWT RFC 8725** | Yes | Yes | Yes |
| **bcrypt (12 rounds)** | Yes | Yes | Yes |
| **Timing-safe comparison** | Yes | Yes | Yes |
| **Audit logging** | Yes | Yes | Yes |
| **__Host- prefix** | Yes | Yes | Yes |

All three API styles implement identical security patterns.

---

## Client Implementation

### React Example

```typescript
// apps/admin/src/lib/auth.ts

// Read CSRF token from cookie
function getCsrfToken(): string | null {
  const match = document.cookie.match(/__Host-csrf=([^;]+)/)
    ?? document.cookie.match(/csrf=([^;]+)/);
  return match?.[1] ?? null;
}

// Login
export async function login(email: string, password: string) {
  const response = await fetch('http://localhost:4000/auth/login', {
    method: 'POST',
    credentials: 'include', // Required for cookies
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  return response.json();
}

// Logout (requires CSRF token)
export async function logout() {
  const csrfToken = getCsrfToken();

  await fetch('http://localhost:4000/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-CSRF-Token': csrfToken ?? '',
    },
  });
}

// Refresh tokens (requires CSRF token)
export async function refreshTokens() {
  const csrfToken = getCsrfToken();

  const response = await fetch('http://localhost:4000/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-CSRF-Token': csrfToken ?? '',
    },
  });

  if (!response.ok) {
    throw new Error('Session expired');
  }

  return response.json();
}

// Authenticated request
export async function fetchWithAuth(
  url: string,
  accessToken: string,
  options: RequestInit = {}
) {
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${accessToken}`,
    },
  });
}
```

---

## Testing

### E2E Test Coverage

| Test | Category | Verifies |
|------|----------|----------|
| `creates a new user and returns tokens` | Signup | User created in DB, session created |
| `rejects duplicate email signup` | Signup | 409 status, unique constraint |
| `rejects invalid email format` | Validation | 400 status, Zod validation |
| `rejects weak password` | Validation | 400 status, password rules |
| `authenticates existing user` | Login | Token returned, attempt logged |
| `rejects invalid password` | Login | 401 status, failed attempt logged |
| `rejects non-existent user` | Login | 401 status, timing-safe |
| `returns current user with valid token` | Auth | JWT verification |
| `rejects request without token` | Auth | 401 status |
| `rejects invalid token` | Auth | 401 status |
| `rotates refresh token` | Refresh | New token, session updated |
| `rejects without cookie` | Refresh | 401 status |
| `invalidates session` | Logout | Session deleted in DB |
| `handles no session gracefully` | Logout | No error |
| `revokes token family on reuse` | Security | All family sessions deleted |
| `serves Swagger UI` | OpenAPI | /api-docs accessible |
| `returns OpenAPI spec` | OpenAPI | /openapi.json valid |

---

## Files Modified

| File | Purpose |
|------|---------|
| `apps/rest/src/middleware/csrf.ts` | CSRF protection implementation |
| `apps/rest/src/middleware/rateLimiter.ts` | Rate limiting middleware |
| `apps/rest/src/routes/auth.ts` | Auth endpoints with security |
| `apps/rest/src/config/auth.ts` | Security configuration |
| `apps/rest/src/utils/audit.ts` | Audit event logging |
| `apps/rest/src/rest.e2e.test.ts` | Security E2E tests |

---

## References

- [ADR-005: GraphQL Authentication Token Strategy and CSRF Protection](./ADR-005-graphql-authentication-token-strategy-csrf.md)
- [ADR-105: tRPC Security Implementation](./ADR-105-trpc-authentication-token-strategy-csrf.md)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [RFC 8725: JSON Web Token Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [__Host- Cookie Prefix](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes)
