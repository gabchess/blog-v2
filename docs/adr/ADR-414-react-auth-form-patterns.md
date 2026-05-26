# ADR-414: React Auth Form and State Patterns

## Status
Proposed

## Context
Phase 3 of QF Simulation Admin Auth requires:
1. Adding auth API functions and token management to the frontend
2. Creating a login/signup form with proper UX
3. Protecting the admin view with authentication check

Key decisions needed:
- Auth state management approach (useState vs Context vs Zustand)
- Form handling pattern (controlled vs React 19 actions)
- Error handling and loading state UX
- Accessibility requirements for auth forms

## Research Findings

### Web Sources
- **Context is standard for auth**: Auth state is a "near perfect candidate for React Context" - global state that changes infrequently
- **TkDodo (React Query maintainer)**: "Don't use context for state management. Use it for dependency injection only"
- **90% Rule**: useState for local, prop drilling for simple shared, Context when prop drilling is unwieldy
- **Persistence required**: Auth state must persist across refreshes (but ADR-301 accepts in-memory for this demo)

### Expert Opinions (Twitter/X)
- **@devongovett (React Aria creator)**: Built-in form validation with client-side constraints, custom validation, server validation
- **@kentcdodds**: "Render AuthenticatedApp or UnauthenticatedApp based on auth state" - simplifies conditionals
- **Dan Abramov**: Goal is for good UX to "just work by default"

### Production Examples (GitHub)
- **bezkoder/react-typescript-login-example**: Formik + Yup validation, loading/error state handling
- **usehooks.com useAuth pattern**: Clean hook-based auth, easily adaptable to any backend
- **Kent C. Dodds pattern**: AuthProvider blocks rendering until auth state determined, conditional rendering at app root

### Official Guidance (React Docs)
- **5-step process**: Identify visual states, determine triggers, represent with useState, remove non-essential, connect handlers
- **Avoid paradox states**: Use status enum ('typing' | 'submitting' | 'success') instead of multiple booleans
- **useCallback**: Only use when passing to memoized children or as dependency for other hooks
- **Error Boundaries**: Don't catch event handler errors - use try/catch in handlers

### Accessibility (WCAG/ARIA)
- **aria-invalid="true"**: Mark invalid fields
- **aria-describedby**: Link error messages to inputs
- **aria-live="polite"**: Announce errors without interrupting
- **Labels**: Explicit `<label>` elements, "(required)" text not asterisk
- **Focus**: Move focus to error field on submission failure

## Decision

### 1. Use Simple useState (Not Context) for Auth State

```typescript
// In App.tsx - simple state at the top level
const [isLoggedIn, setIsLoggedIn] = useState(() => !!getAccessToken());
```

**Rationale:**
- QF Simulator is a small app with single-page auth flow
- Auth state only needed in App.tsx (to render LoginForm vs AdminPanel)
- No deep component tree requiring Context
- Matches existing widget app pattern (apps/widget/src/App.tsx)
- ADR-301 already covers token storage strategy (in-memory)

### 2. Use Controlled Form with Local State

```typescript
function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, error } = useAuth();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      onSuccess();
    } catch {
      // Error handled by useAuth hook
    }
  };
}
```

**Rationale:**
- React 19 form actions (useActionState) are newer and less familiar
- Controlled form matches existing patterns in the codebase
- useAuth hook encapsulates loading/error state (separation of concerns)
- Simple and readable for a demo application

### 3. Custom useAuth Hook for Reusable Auth Logic

```typescript
export function useAuth(): UseAuthReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // signup, login, logout with try/catch/finally pattern
}
```

**Rationale:**
- Separates API concerns from UI components
- Provides consistent loading/error state handling
- Matches existing hooks pattern in qf-simulator
- Easily testable

### 4. Conditional Rendering for Route Protection

```typescript
// In App.tsx
{view === 'admin' && !isLoggedIn && <LoginForm onSuccess={handleLogin} />}
{view === 'admin' && isLoggedIn && <AdminPanel />}
```

**Rationale:**
- No React Router in qf-simulator (simple view toggle)
- Kent C. Dodds recommends this pattern for apps without router
- Makes protected content unreachable to unauthenticated users
- Clean separation between auth states

### 5. Accessibility Requirements

- Explicit `<label htmlFor="...">` for all inputs
- `aria-invalid` and `aria-describedby` for validation errors
- `disabled` attribute on submit button during loading
- `minLength={12}` for password (matches backend requirement)

## Consequences

### Positive
- Simple, understandable code without external dependencies
- Matches existing patterns in the monorepo (widget app)
- Proper accessibility for login form
- Clean separation: useAuth hook for logic, LoginForm for UI

### Negative
- Token lost on page refresh (acceptable per ADR-301)
- No auto-refresh of token (demo scope)
- State not shared across tabs (single-tab usage expected)

### Trade-offs
- Chose simplicity over sophistication - useState over Context
- Chose familiarity over novelty - controlled forms over React 19 actions
- Accepted UX limitation (re-login on refresh) for simpler implementation

## References
- [ADR-301: Widget Token Management Strategy](./ADR-301-widget-token-management-strategy.md)
- [Kent C. Dodds - Authentication in React Applications](https://kentcdodds.com/blog/authentication-in-react-applications)
- [React Docs - Reacting to Input with State](https://react.dev/learn/reacting-to-input-with-state)
- [Smashing Magazine - Guide to Accessible Form Validation](https://www.smashingmagazine.com/2023/02/guide-accessible-form-validation/)
- [React Aria - Form Validation](https://react-spectrum.adobe.com/react-aria/forms.html)
