# ADR-412: Express JWT Middleware Patterns

## Status
Accepted

## Context
Phase 1 of QF Simulation Admin Auth requires creating reusable JWT authentication middleware for Express. Key decisions needed:
1. How to structure the middleware
2. How to extend Express Request type in TypeScript
3. When to return 401 vs 403 for auth failures
4. How to handle JWT verification securely

## Research Findings

### Web Sources
- **Middleware separation**: Authentication (identity verification) should be separate from authorization (permission checking) for composability
- **Error codes**: Strong consensus that 401 = "not authenticated" (no/invalid token), 403 = "authenticated but forbidden" (lacks permission)
- **Token storage**: HttpOnly cookies preferred over localStorage for XSS prevention (not applicable here - using Bearer header)

### Expert Opinions (Twitter/X)
- **@lirantal (Snyk)**: JWTs must use HTTPS, HttpOnly/Secure flags for cookies, server-side validation essential
- **@matteocollina (Fastify)**: Emphasizes explicit algorithm verification to prevent downgrade attacks
- **Auth0/express-jwt maintainers**: `algorithms` parameter is **required** in modern usage

### Production Examples (GitHub)
- **auth0/express-jwt (4k+ stars)**: Uses `req.auth` for decoded payload, exports `JWTRequest` type
- **mwanago/express-typescript (891 stars)**: Custom `RequestWithUser` interface, separate exception classes
- **andregardi/jwt-express-typeorm**: Uses `res.locals.jwtPayload` to avoid type augmentation

### Official Guidance
- **Express**: Middleware must call `next()` unless ending response; error handlers need 4 params
- **TypeScript**: Use `declare module 'express-serve-static-core'` for Request augmentation
- **jsonwebtoken**: Always specify `algorithms` option; never use `jwt.decode()` for validation

## Decision

### 1. Return 403 (not 401) for auth failures
Per PROJECT.md requirement: "Route protection returning 403 for unauthenticated requests."

Rationale: PROJECT.md explicitly specifies 403. While RFC 7235 suggests 401 for missing auth, 403 is acceptable for this use case where we don't want to challenge for credentials.

### 2. Use Express module augmentation for Request type
```typescript
declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}
```

Rationale: Global augmentation works across all routes without explicit casting. Simpler than custom interface pattern.

### 3. Verify JWT with explicit options
```typescript
jwt.verify(token, secret, {
  algorithms: ['HS256'],
  issuer: jwtConfig.issuer,
  audience: jwtConfig.audience,
});
```

Rationale: Prevents algorithm confusion attacks. Matches existing pattern in `apps/rest/src/routes/auth.ts`.

### 4. Extract token from Authorization header
```typescript
const authHeader = req.headers.authorization;
if (!authHeader?.startsWith('Bearer ')) {
  return res.status(403).json({ error: 'Forbidden' });
}
const token = authHeader.substring(7);
```

Rationale: Standard OAuth2 Bearer token format. Matches existing `/auth/me` pattern.

## Consequences

### Positive
- Consistent 403 response matches PROJECT.md specification
- Type-safe `req.userId` available in all routes
- Reuses proven JWT verification pattern from existing codebase
- Explicit algorithm prevents security vulnerabilities

### Negative
- 403 differs from RFC 7235 recommendation (401 for unauthenticated)
- Global Request augmentation affects all routes (but optional property mitigates)

### Trade-offs
- Chose simplicity (403 for all failures) over granular error codes (401 vs 403)
- Accepted for demo scope; production might want 401 for missing token, 403 for valid-but-forbidden

## References
- [Express.js Middleware Guide](https://expressjs.com/en/guide/writing-middleware.html)
- [auth0/express-jwt](https://github.com/auth0/express-jwt)
- [TypeScript Declaration Merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html)
- [jsonwebtoken npm](https://www.npmjs.com/package/jsonwebtoken)
- [HTTP 401 vs 403](https://cyberpanel.net/blog/401-vs-403)
