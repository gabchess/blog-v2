# ADR-413: Route Protection and Resource Ownership Patterns

## Status
Proposed

## Context
Phase 2 of QF Simulation Admin Auth requires:
1. Protecting admin QF routes with auth middleware
2. Filtering data by adminId for per-user data isolation
3. Preventing admins from accessing/modifying other admins' rounds

Key decisions needed:
- Inline middleware vs router-level middleware for route protection
- Ownership verification approach (middleware vs handler vs service layer)
- Error response patterns (403 vs 404 for ownership mismatch)

## Research Findings

### Web Sources
- **Multi-tenancy consensus**: For per-user filtering, shared database with discriminator column (e.g., `adminId`) is the most practical approach
- **Query-level enforcement**: "The only way this model works is if queries are tenant-scoped by construction, not by habit" — Medium: Multi-tenancy in REST API
- **Defense-in-depth**: Multiple layers of protection (auth middleware + ownership check in handler/service)
- **Context propagation**: Carry ownership context (userId) explicitly through every layer

### Expert Opinions (Twitter/X)
- **@Webb3Fitty**: "Use middleware to streamline authentication, use paths to group routes based on access, create reusable wrappers to check authorization on each route"
- **Corey Cleary**: "Making everything middleware is the biggest anti-pattern — middleware should handle cross-cutting concerns, not business logic"
- **Liran Tal (Snyk)**: Emphasizes constant-time comparison and never hardcoding secrets

### Production Examples (GitHub)
- **gothinkster/node-express-realworld-example-app (5.3k stars)**: Uses inline `auth.required` middleware, ownership checks in service layer throwing `HttpException(403)`
- **joshnuss/express-role-based-permissions**: Factory pattern for reusable permission middleware
- **auth0/express-openid-connect**: Uses `requiresAuth()` inline for selective route protection

### Official Guidance
- **Express docs**: Router-level middleware (`router.use()`) for grouped routes, inline for selective protection
- **Error handlers**: Must have four arguments, define last in middleware chain
- **Recommended order**: Helmet → Session → Validation → Rate limiting → Routes → Error handler

## Decision

### 1. Use Inline Middleware for Route Protection

Apply `requireAuth` middleware directly to each protected route rather than using `router.use()`.

```typescript
// Selected approach: inline middleware
router.post('/rounds', requireAuth, (req, res) => { ... });
router.delete('/rounds/current', requireAuth, (req, res) => { ... });

// NOT: router.use(requireAuth) which would protect ALL routes
```

**Rationale:**
- QF routes have mixed access: admin routes need auth, voter routes must stay public
- Inline application makes protection explicit and visible at each route definition
- Follows gothinkster/realworld pattern used by thousands of developers
- Avoids accidental protection of public endpoints

### 2. Ownership Check in Route Handler (Not Middleware)

Check ownership directly in each handler after fetching the resource.

```typescript
router.delete('/rounds/current', requireAuth, (req, res) => {
  const round = getRound();
  if (!round) return res.status(404).json({ error: 'No active round' });

  // Ownership check
  if (round.adminId && round.adminId !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Proceed with delete
  clearRound();
  return res.status(200).json({ message: 'Round deleted' });
});
```

**Rationale:**
- In-memory state with single round simplifies lookup (no database query needed)
- Ownership check is 2 lines, not worth abstraction into middleware
- Keeps authorization logic visible in handler
- `round.adminId &&` allows legacy rounds without adminId to work

### 3. Return 403 (Not 404) for Ownership Mismatch

Return 403 Forbidden when authenticated user doesn't own the resource.

**Rationale:**
- PROJECT.md specifies "403 for unauthenticated/unauthorized requests"
- User is authenticated but lacks permission — clear 403 case
- Some experts recommend 404 to hide resource existence, but PROJECT.md is explicit
- Consistent with ADR-412 decision for auth failures

### 4. Set adminId at Creation Time

Set `adminId` from `req.userId` when creating a new round.

```typescript
const round: Round = {
  id: randomUUID(),
  // ... other fields
  adminId: req.userId,  // Set from authenticated user
};
```

**Rationale:**
- Single point of truth for ownership
- requireAuth ensures req.userId is always set when route handler runs
- Optional field allows legacy rounds to continue working

## Consequences

### Positive
- Explicit protection at each route (no hidden middleware inheritance)
- Simple ownership check (2 lines per handler)
- Backward compatible with existing rounds (optional adminId)
- Matches PROJECT.md security requirements

### Negative
- Repetitive inline middleware (`requireAuth` on each protected route)
- Manual ownership check in each handler (could miss one)
- No reusable ownership middleware (acceptable given simplicity)

### Trade-offs
- Chose explicit inline middleware over router-level grouping because QF routes have mixed access patterns
- Chose handler-level ownership check over middleware factory because in-memory state is simple
- Accepted repetition for visibility and safety

## References
- [gothinkster/node-express-realworld-example-app](https://github.com/gothinkster/node-express-realworld-example-app)
- [Express.js Middleware Guide](https://expressjs.com/en/guide/using-middleware.html)
- [Multi-tenancy in REST API](https://medium.com/@vivekmadurai/multi-tenancy-in-rest-api-a570d728620c)
- [Express role-based permissions (GitHub Gist)](https://gist.github.com/joshnuss/37ebaf958fe65a18d4ff)
- [ADR-412: Express JWT Middleware Patterns](./ADR-412-express-jwt-middleware-patterns.md)
