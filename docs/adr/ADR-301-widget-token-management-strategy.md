# ADR-301: Widget Token Management Strategy

## Status
Proposed

## Context
The widget app needs to manage JWT access tokens and refresh tokens securely. We need to decide where to store tokens and how to handle automatic refresh.

The REST API (apps/rest) uses HttpOnly cookies for refresh tokens and returns access tokens in response bodies.

## Research Findings

### Web Sources
- **localStorage is high-risk**: XSS can leak all stored tokens (documented attacks stealing 10,000+ tokens)
- **Memory + HttpOnly cookie**: Consensus pattern for 2025
- **Access token**: 15-30 min lifespan, stored in memory
- **Refresh token**: 7+ days, HttpOnly cookie (set by server)

### Expert Opinions (Twitter/X)
- **Security researchers**: "Stop using localStorage for auth tokens"
- **Consensus**: Memory storage protects against XSS
- **Warning**: Any XSS can execute all user actions if tokens accessible

### Production Examples (GitHub)
- **Axios interceptor pattern**: Request interceptor adds token, response interceptor handles 401 + refresh
- **`_retry` flag**: Prevents infinite refresh loops
- **Fetch wrapper approach**: `refresh-fetch` library shows clean pattern

### Official Guidance
- REST API already uses HttpOnly cookies for refresh tokens
- `credentials: 'include'` required for cookies to be sent

## Decision

### Token Storage
| Token | Storage | Rationale |
|-------|---------|-----------|
| Access Token | Module-scope variable in `client.ts` | XSS-safe, cleared on page refresh |
| Refresh Token | HttpOnly cookie (server-managed) | Cannot be accessed by JS |

### Implementation Pattern

```typescript
// apps/widget/src/api/client.ts

// Module-scope storage (not accessible from console/XSS)
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include', // Send HttpOnly cookies
  });

  // Handle 401 - attempt refresh
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      // Retry original request
      headers.set('Authorization', `Bearer ${accessToken}`);
      return fetch(`/api${path}`, {
        ...options,
        headers,
        credentials: 'include',
      });
    }
  }

  return response;
}
```

### Auto-Refresh Strategy
Per PROJECT.md: "Silent auto-refresh 1 minute before expiry"

1. Decode JWT to get `exp` claim
2. Calculate time until expiry
3. Set timeout to refresh 60 seconds before expiry
4. On refresh: update access token, reset timer
5. On page load: attempt silent refresh (uses HttpOnly cookie)

### Why NOT localStorage
1. **XSS vulnerability**: Any script can read localStorage
2. **No expiry enforcement**: Tokens persist until manually cleared
3. **Cross-tab exposure**: All tabs share the same storage

### Why Memory Storage
1. **XSS-safe**: No API to read module-scope variables
2. **Automatic cleanup**: Cleared on page refresh/close
3. **Matches REST API pattern**: Server expects HttpOnly cookie for refresh

## Consequences

### Positive
- Strong XSS protection (access token not in DOM-accessible storage)
- Clean separation (refresh token fully server-managed)
- Seamless UX with auto-refresh

### Negative
- Page refresh requires re-authentication (or silent refresh via cookie)
- Cannot share auth state across tabs easily

### Trade-offs
- Security over convenience - user re-auths on refresh unless silent refresh works
- This is the recommended modern pattern for SPAs

## References
- [Stop Using localStorage for Auth Tokens](https://judeotine.medium.com/stop-using-localstorage-for-auth-tokens-heres-what-to-do-instead-966ad1eea8f9)
- [JWT Storage: Local Storage vs Cookies](https://cybersierra.co/blog/react-jwt-storage-guide/)
- [DigitalOcean: Secure React with HttpOnly Cookies](https://www.digitalocean.com/community/tutorials/how-to-secure-react-applications-against-xss-attacks-with-http-only-cookies)
- [BezKoder: Axios Interceptors Refresh Token](https://www.bezkoder.com/axios-interceptors-refresh-token/)
- [Auth0: Refresh Tokens Guide](https://auth0.com/blog/refresh-tokens-what-are-they-and-when-to-use-them/)
