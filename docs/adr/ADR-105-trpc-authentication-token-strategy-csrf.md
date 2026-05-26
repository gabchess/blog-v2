# ADR-105: tRPC Security Implementation

## Status
Implemented

## Context

This ADR documents the security implementation for the tRPC API server, ensuring parity with the GraphQL server's security features as defined in ADR-005 (Authentication Token Strategy and CSRF Protection).

The tRPC server initially returned refresh tokens in the response body, which is vulnerable to XSS attacks. This ADR documents the migration to HttpOnly cookies and the implementation of CSRF protection.

---

## Decision

### 1. HttpOnly Cookies for Refresh Tokens

Refresh tokens are now stored in HttpOnly cookies instead of being returned in the response body.

**Why:**
- HttpOnly cookies cannot be accessed by JavaScript, neutralizing XSS attacks
- Automatic handling by the browser reduces client-side complexity
- Consistent with ADR-005 security architecture

**Implementation:**
```typescript
// apps/trpc/src/middleware/csrf.ts
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
fetch('/trpc/auth.logout', {
  credentials: 'include',
  headers: {
    'X-CSRF-Token': csrfToken,
  },
});

// Server-side validation
export function validateCsrf(req: IncomingMessage): boolean {
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];
  // Length check + timing-safe comparison
  if (cookieToken.length !== headerToken.length) return false;
  return timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
}
```

### 3. Refresh Token Rate Limiting

Rate limiting is applied to the refresh endpoint to prevent abuse.

**Configuration (environment-aware):**
```typescript
refreshToken: {
  windowMs: 60 * 1000, // 1 minute
  maxAttempts: isProduction ? 30 : isStaging ? 100 : 10000,
}
```

### 4. Cookie Security Configuration

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
┌─────────────────────────────────────────────────────────────┐
│                    Browser                                   │
│                                                             │
│  1. Login Request                                           │
│     POST /trpc/auth.login                                   │
│     Body: { email, password }                               │
│                                                             │
│  2. Response Sets Cookies:                                  │
│     Set-Cookie: __Host-refresh_token=xyz; HttpOnly; Secure  │
│     Set-Cookie: __Host-csrf=abc123; Secure (NOT HttpOnly)   │
│                                                             │
│  3. Subsequent Requests:                                    │
│     Authorization: Bearer <accessToken>                     │
│     (Cookies sent automatically)                            │
│                                                             │
│  4. Refresh Request:                                        │
│     POST /trpc/auth.refresh                                 │
│     Cookie: __Host-refresh_token=xyz; __Host-csrf=abc123    │
│     X-CSRF-Token: abc123                                    │
└─────────────────────────────────────────────────────────────┘
```

### Context Extension

The tRPC context now includes `req` and `res` for cookie operations:

```typescript
export interface Context {
  currentUser: User | null;
  sessionId: string | null;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  req: IncomingMessage;  // For reading cookies
  res: ServerResponse;   // For setting cookies
}
```

---

## API Changes

### Deprecated Fields

The following response fields are deprecated and always return `null`:

| Procedure | Field | Reason |
|-----------|-------|--------|
| `auth.signup` | `refreshToken` | Now set via HttpOnly cookie |
| `auth.login` | `refreshToken` | Now set via HttpOnly cookie |
| `auth.refresh` | `refreshToken` | Now set via HttpOnly cookie |

### Input Changes

The following input fields are now optional (fallback to cookie):

| Procedure | Field | Behavior |
|-----------|-------|----------|
| `auth.logout` | `refreshToken` | Reads from cookie first, then input |
| `auth.refresh` | `refreshToken` | Reads from cookie first, then input |

---

## Security Comparison: tRPC vs GraphQL

| Feature | GraphQL | tRPC |
|---------|---------|------|
| HttpOnly refresh tokens | ✅ | ✅ |
| CSRF double-submit | ✅ | ✅ |
| Refresh token rate limiting | ✅ | ✅ |
| Token rotation | ✅ | ✅ |
| Reuse detection | ✅ | ✅ |
| Grace period | ✅ | ✅ |
| Device binding (prod) | ✅ | ✅ |

Both implementations now have full security parity.

---

## Client Implementation

### React Example

```typescript
// TRPCProvider.tsx
const trpcClient = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:4002/trpc',
      fetch(url, options) {
        // Read CSRF token from cookie (try __Host- prefix first for production)
        const csrfToken = document.cookie.match(/__Host-csrf=([^;]+)/)?.[1]
          ?? document.cookie.match(/csrf=([^;]+)/)?.[1];

        return fetch(url, {
          ...options,
          credentials: 'include', // Send cookies
          headers: {
            ...options?.headers,
            'X-CSRF-Token': csrfToken ?? '',
          },
        });
      },
    }),
  ],
});
```

### Important: Streaming Links

**Do NOT use `unstable_httpBatchStreamLink`** if you need cookie-based auth. Streaming prevents header modification after the stream begins. Use `httpBatchLink` instead.

---

## Testing

### E2E Test Coverage (61 tests)

**Auth Router Tests** (`trpc.e2e.test.ts`)

| Test | Expected Outcome |
|------|------------------|
| signup sets HttpOnly refresh token cookie | Cookie set with HttpOnly, SameSite=Strict |
| signup rejects duplicate email | CONFLICT error |
| signup rejects short passwords | BAD_REQUEST error |
| signup rejects common passwords | BAD_REQUEST error |
| login sets HttpOnly refresh token cookie | Cookie set, accessToken returned |
| login rejects invalid password | UNAUTHORIZED error |
| login rejects non-existent user | UNAUTHORIZED error (same message to prevent enumeration) |
| refresh rotates refresh token cookie | New cookie set, old token invalidated |
| refresh rejects when no cookie present | UNAUTHORIZED error |
| logout clears refresh token cookie | Cookie cleared with Max-Age=0 |

**User Router Tests** (`trpc.e2e.test.ts`)

| Test | Expected Outcome |
|------|------------------|
| user.me returns current user | User object with id, email, name |
| user.me requires authentication | UNAUTHORIZED if no valid token |
| user.update updates user name | Updated user returned |
| user.update rejects duplicate email | CONFLICT error |
| user.changePassword with correct password | Success, can login with new password |
| user.changePassword rejects incorrect password | UNAUTHORIZED error |
| user.changePassword validates new password strength | BAD_REQUEST for weak passwords |

**Session Router Tests** (`trpc.e2e.test.ts`)

| Test | Expected Outcome |
|------|------------------|
| session.mySessions lists user sessions | Array of sessions with isCurrent flag |
| session.mySessions requires authentication | UNAUTHORIZED if no valid token |
| session.revoke invalidates another session | Session deleted, returns true |
| session.revoke prevents current session revocation | BAD_REQUEST error |
| session.revoke blocks IDOR (other user's session) | NOT_FOUND/BAD_REQUEST error |
| session.revokeAll invalidates all other sessions | All except current deleted |

**CSRF Protection Tests** (`trpc.e2e.test.ts`, `token-abuse.pentest.e2e.test.ts`)

| Test | Expected Outcome |
|------|------------------|
| blocks POST without CSRF token | 403 FORBIDDEN |
| blocks POST with wrong CSRF token | 403 FORBIDDEN |
| allows POST with valid CSRF token | Request proceeds |
| allows GET without CSRF token | Request proceeds (queries exempt) |

**Rate Limiting Tests** (`trpc.e2e.test.ts`, `token-abuse.pentest.e2e.test.ts`)

| Test | Expected Outcome |
|------|------------------|
| records login attempts | LoginAttempt records created |
| tracks refresh attempts via session lastUsedAt | lastUsedAt updated on refresh |
| validates lockout configuration exists | Config has threshold, window, duration |
| validates rate limiting is properly configured | Config has sensible production limits |

**Token Abuse Tests** (`token-abuse.pentest.e2e.test.ts`)

| Test | Expected Outcome |
|------|------------------|
| BLOCKS refresh token reuse after rotation | UNAUTHORIZED or grace period allows |
| BLOCKS expired refresh token | UNAUTHORIZED with "expired" message |
| BLOCKS invalid refresh token (random UUID) | UNAUTHORIZED error |

**JWT Attack Tests** (`security.pentest.e2e.test.ts`)

| Test | Expected Outcome |
|------|------------------|
| BLOCKS invalid/malformed JWT | UNAUTHORIZED error |
| BLOCKS JWT signed with wrong secret | UNAUTHORIZED error |
| BLOCKS expired JWT | UNAUTHORIZED error |
| BLOCKS JWT with none algorithm | UNAUTHORIZED error |
| BLOCKS JWT with wrong issuer | UNAUTHORIZED error |
| BLOCKS JWT with wrong audience | UNAUTHORIZED error |

**Authorization Bypass Tests** (`security.pentest.e2e.test.ts`)

| Test | Expected Outcome |
|------|------------------|
| BLOCKS unauthenticated access to user.me | UNAUTHORIZED error |
| BLOCKS unauthenticated access to session.mySessions | UNAUTHORIZED error |
| BLOCKS unauthenticated access to user.changePassword | UNAUTHORIZED error |
| BLOCKS user from revoking another user's session | NOT_FOUND/BAD_REQUEST error |
| ALLOWS user to access their own data | Success |

**Protected Endpoints with Invalid Tokens** (`security.pentest.e2e.test.ts`)

| Test | Expected Outcome |
|------|------------------|
| BLOCKS session.mySessions with expired JWT | UNAUTHORIZED error |
| BLOCKS user.changePassword with wrong secret JWT | UNAUTHORIZED error |
| BLOCKS session.revoke with none algorithm JWT | UNAUTHORIZED error |
| BLOCKS session.mySessions with wrong issuer JWT | UNAUTHORIZED error |
| BLOCKS user.me with wrong audience JWT | UNAUTHORIZED error |

**Edge Cases** (`security.pentest.e2e.test.ts`)

| Test | Expected Outcome |
|------|------------------|
| BLOCKS empty Bearer token | UNAUTHORIZED error |
| BLOCKS JWT with non-existent user ID | UNAUTHORIZED error |
| BLOCKS protected endpoint with non-existent user JWT | UNAUTHORIZED error |
| validates CORS configuration is secure | No wildcard origins, credentials enabled |

### Manual Testing

```bash
# Login and check cookies
curl -c cookies.txt -X POST http://localhost:4002/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"password123"}'

# Check cookies file - should see refresh_token with HttpOnly flag
cat cookies.txt

# Refresh with cookie (CSRF validation may be disabled in dev)
CSRF=$(grep csrf cookies.txt | awk '{print $7}')
curl -b cookies.txt -X POST http://localhost:4002/trpc/auth.refresh \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{}'
```

---

## Files Modified

| File | Changes |
|------|---------|
| `apps/trpc/src/middleware/csrf.ts` | New - CSRF utilities and cookie helpers |
| `apps/trpc/src/trpc.ts` | Added `req`/`res` to context |
| `apps/trpc/src/routers/auth.ts` | HttpOnly cookies, rate limiting |
| `apps/trpc/src/index.ts` | CSRF cookie initialization |
| `apps/trpc/src/config/auth.ts` | Added X-CSRF-Token to CORS headers |

---

## References

- [ADR-005: Authentication Token Strategy and CSRF Protection](./ADR-005-graphql-authentication-token-strategy-csrf.md)
- [ADR-104: tRPC API Architecture](./ADR-104-trpc-api-architecture.md)
- [ADR-106: tRPC Authentication and Authorization](./ADR-106-trpc-authentication-authorization.md)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [tRPC Discussion #4226: Setting headers from procedures](https://github.com/trpc/trpc/discussions/4226)

---

## Changelog

| Date | Change |
|------|--------|
| 2025-01-16 | Initial implementation with HttpOnly cookies, CSRF, and rate limiting |
