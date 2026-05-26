# ADR-300: Widget App Scaffold Patterns

## Status
Proposed

## Context
Phase 1 of the widget app requires establishing a Vite + React project structure. We need to decide on configuration patterns, project structure, and auth state management approach that will scale for phases 2-5.

The widget app is a REST API demo - it must NOT use GraphQL or tRPC, only fetch() for API calls.

## Research Findings

### Web Sources
- **SWC over Babel**: 2025 consensus recommends `@vitejs/plugin-react-swc` for faster compilation, but this monorepo uses `@vitejs/plugin-react` consistently - we should match existing apps
- **Module resolution**: Use `"moduleResolution": "bundler"` for optimal Vite + TypeScript integration
- **Feature-based structure**: Recommended `src/features/{name}/` organization scales better than flat structures

### Expert Opinions (Twitter/X)
- **Kent C. Dodds**: Advocates Context API for auth, conditional rendering based on auth state
- **Dan Abramov**: Start with vanilla React state, don't reach for libraries prematurely
- **Consensus**: Access tokens in memory, refresh tokens in HttpOnly cookies

### Production Examples (GitHub)
- **xarielah/jwt-auth-example**: Vite React + Express, memory + HttpOnly cookie pattern
- **GravityTwoG/react-jwt-auth**: Clear separation with API layer managing all auth logic
- **vlki/refresh-fetch**: Lightweight fetch wrapper for token refresh

### Official Guidance
- **Vite docs**: Use `changeOrigin: true` for proxy, rewrite paths for clean backend URLs
- **React docs**: Start with useState, lift state up, use Context to avoid prop drilling
- **Performance warning**: Always memoize context values with `useMemo`

## Decision

### 1. Project Configuration
Match existing `apps/admin` patterns:
- Use `@vitejs/plugin-react` (not SWC) for consistency
- Port 3002 to avoid collision with web (3000), admin (3001)
- Proxy `/api` to `http://localhost:4000` (REST API)

### 2. File Structure
Follow established feature-based pattern:
```
apps/widget/
├── package.json          # NO GraphQL deps
├── tsconfig.json
├── vite.config.ts        # Proxy to :4000
├── index.html
└── src/
    ├── main.tsx          # NO urql Provider
    ├── App.tsx           # Auth state shell
    ├── api/
    │   └── client.ts     # Fetch wrapper + token helpers
    ├── hooks/
    │   ├── useAuth.ts
    │   ├── useMe.ts
    │   └── useTokenTimer.ts
    └── features/
        ├── auth/
        ├── dashboard/
        └── status-bar/
```

### 3. Auth State Management
- **Phase 1**: Simple `useState<boolean>` for `isLoggedIn`
- **Phase 2+**: Add hooks layer (`useAuth`, `useMe`) that manage state
- **NO Context needed** for this simple app - hooks encapsulate state
- **Token storage**: Memory for access token (module-scope variable in `client.ts`)

### 4. Why NOT Use Context
The widget app is simple enough that:
- Auth state only needs to flow down one level (App → components)
- Hooks can encapsulate token management without global state
- Following Dan Abramov's advice: don't add abstractions until needed

## Consequences

### Positive
- Matches existing monorepo patterns (easier for template adopters)
- Simple implementation, easy to understand
- Clean code seams for "add endpoint in 5 min" goal

### Negative
- No state persistence across page refresh (by design for security)
- Must lift state if components need to share auth state

### Trade-offs
- Chose simplicity over flexibility - this is intentional for a demo app
- Memory token storage means re-auth on refresh (acceptable for security)

## References
- [Vite Server Options](https://vite.dev/config/server-options.html)
- [React Managing State](https://react.dev/learn/managing-state)
- [Kent C. Dodds Auth Pattern](https://kentcdodds.com/blog/authentication-in-react)
- [xarielah/jwt-auth-example](https://github.com/xarielah/jwt-auth-example)
- [Robin Wieruch React Folder Structure](https://www.robinwieruch.de/react-folder-structure/)
