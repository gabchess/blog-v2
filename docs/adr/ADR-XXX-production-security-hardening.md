# ADR-006: Production Security Hardening

## Status
Draft (Pending Implementation)

## Context

A comprehensive security audit of the ADR documentation and codebase against 2026 industry best practices identified **64 security gaps** across five domains that must be addressed before production deployment.

### Audit Scope

| Domain | Gaps Found | Critical | High | Medium |
|--------|------------|----------|------|--------|
| Docker/Container Security | 13 | 6 | 2 | 5 |
| GraphQL API Security | 10 | 0 | 5 | 5 |
| Authentication (PRD-AUTH) | 12 | 5 | 5 | 2 |
| CI/CD & Secrets Management | 15 | 3 | 7 | 5 |
| MongoDB/Database Security | 14 | 5 | 3 | 6 |

### Current Production Readiness

| Domain | Score | Status |
|--------|-------|--------|
| Container Security | 24% | Not Ready |
| GraphQL Security | 47% | Partial |
| Authentication | 60% | Partial |
| CI/CD & Secrets | 12% | Not Ready |
| Database Security | 0% | Not Ready |
| **Overall** | **~29%** | **Not Production Ready** |

### Security Standards Referenced

- OWASP Top 10 (2025)
- OWASP Authentication Cheat Sheet
- OWASP GraphQL Cheat Sheet
- NIST SP 800-63B-4 Digital Identity Guidelines
- NIST SP 800-190 Container Security
- RFC 8725 JWT Best Current Practices
- CIS Docker Benchmark v1.6
- CIS Kubernetes Benchmark v1.8

---

## Decision

We adopt a **phased security hardening approach** to achieve production readiness. Each phase addresses ship-blocking issues in priority order, with clear exit criteria.

---

## Part 1: Docker & Container Security

### Current Implementation (What We Have)

| Control | Status |
|---------|--------|
| Multi-stage build with turbo prune | ✅ Implemented |
| Non-root user (UID 1001) | ✅ Implemented |
| dumb-init for signal handling | ✅ Implemented |
| Node 22 Slim base image | ✅ Implemented |
| Health checks | ✅ Implemented |

### Critical Gaps (Must Implement)

#### 1.1 Container Image Vulnerability Scanning

**Gap**: No CVE scanning in CI/CD pipeline. Vulnerable images can be deployed without detection.

**Decision**: Integrate Trivy for container scanning with CI/CD gate.

**Implementation**:
```yaml
# .github/workflows/ci.yml - Add after build step
- name: Build Docker Image
  run: docker build --build-arg APP=graphql -t myapp-graphql .

- name: Scan with Trivy
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: 'myapp-graphql'
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'CRITICAL,HIGH'
    exit-code: '1'  # Fail build on critical/high CVEs

- name: Upload SARIF to GitHub Security
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: 'trivy-results.sarif'
```

**Exit Criteria**: All container builds scanned; critical/high CVEs block deployment.

---

#### 1.2 Software Bill of Materials (SBOM)

**Gap**: No SBOM generation. Cannot trace vulnerabilities to affected deployments.

**Decision**: Generate CycloneDX SBOM for every container build.

**Implementation**:
```yaml
# .github/workflows/ci.yml - Add after Trivy scan
- name: Generate SBOM
  uses: anchore/sbom-action@v0
  with:
    image: myapp-graphql
    format: cyclonedx-json
    output-file: sbom.cyclonedx.json

- name: Upload SBOM as artifact
  uses: actions/upload-artifact@v4
  with:
    name: sbom-graphql
    path: sbom.cyclonedx.json
```

**Exit Criteria**: SBOM generated and stored for every production image.

---

#### 1.3 Container Image Signing

**Gap**: No image signing. Cannot verify image authenticity before deployment.

**Decision**: Sign images with Cosign/Sigstore for supply chain security.

**Implementation**:
```yaml
# .github/workflows/ci.yml - Add after push to registry
- name: Install Cosign
  uses: sigstore/cosign-installer@v3

- name: Sign Image
  env:
    COSIGN_PASSWORD: ${{ secrets.COSIGN_PASSWORD }}
  run: |
    cosign sign --key env://COSIGN_PRIVATE_KEY \
      ghcr.io/${{ github.repository }}/graphql:${{ github.sha }}
```

**Verification in Kubernetes** (via Kyverno policy):
```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signature
spec:
  validationFailureAction: Enforce
  rules:
    - name: verify-signature
      match:
        resources:
          kinds: [Pod]
      verifyImages:
        - imageReferences: ["ghcr.io/*/graphql:*"]
          attestors:
            - entries:
                - keys:
                    publicKeys: |-
                      -----BEGIN PUBLIC KEY-----
                      ...
                      -----END PUBLIC KEY-----
```

**Exit Criteria**: All production images signed; unsigned images rejected by cluster.

---

#### 1.4 Read-Only Root Filesystem

**Gap**: Container filesystem is writable. Attackers can write malicious binaries.

**Decision**: Enable read-only root filesystem in Kubernetes SecurityContext.

**Implementation**:
```yaml
# k8s/graphql/deployment.yaml
spec:
  template:
    spec:
      containers:
        - name: graphql
          securityContext:
            readOnlyRootFilesystem: true
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            - name: logs
              mountPath: /app/logs
      volumes:
        - name: tmp
          emptyDir: {}
        - name: logs
          emptyDir: {}
```

**Exit Criteria**: All production pods run with read-only root filesystem.

---

#### 1.5 Kubernetes Security Context Hardening

**Gap**: Missing seccomp profile, capabilities not dropped, privilege escalation not blocked.

**Decision**: Apply comprehensive SecurityContext to all pods.

**Implementation**:
```yaml
# k8s/graphql/deployment.yaml
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
        seccompProfile:
          type: RuntimeDefault

      containers:
        - name: graphql
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 1001
            capabilities:
              drop: ["ALL"]
```

**Exit Criteria**: All pods pass CIS Kubernetes Benchmark security checks.

---

#### 1.6 Kubernetes Network Policies

**Gap**: No network segmentation. Compromised pod can attack any service.

**Decision**: Implement default-deny with explicit allow rules.

**Implementation**:
```yaml
# k8s/network-policies/default-deny.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress

---
# k8s/network-policies/graphql-allow.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: graphql-network-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: graphql-api
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
      ports:
        - protocol: TCP
          port: 4001
  egress:
    # DNS
    - to:
        - namespaceSelector: {}
      ports:
        - protocol: UDP
          port: 53
    # MongoDB
    - to:
        - podSelector:
            matchLabels:
              app: mongodb
      ports:
        - protocol: TCP
          port: 27017
```

**Exit Criteria**: All namespaces have default-deny; only required traffic flows allowed.

---

### High-Priority Gaps

#### 1.7 External Secrets Operator

**Gap**: Secrets created imperatively via kubectl. No encryption at rest, no rotation.

**Decision**: Deploy External Secrets Operator with HashiCorp Vault backend.

**Implementation**:
```yaml
# k8s/external-secrets/secret-store.yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: vault-backend
  namespace: production
spec:
  provider:
    vault:
      server: "https://vault.internal:8200"
      path: "secret"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "graphql-app"

---
# k8s/external-secrets/app-secrets.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: app-secrets
  namespace: production
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: app-secrets
    creationPolicy: Owner
  data:
    - secretKey: database-url
      remoteRef:
        key: secret/data/graphql/database
        property: url
    - secretKey: jwt-secret
      remoteRef:
        key: secret/data/graphql/jwt
        property: secret
```

**Exit Criteria**: All secrets managed via ESO; no static secrets in cluster.

---

### Medium-Priority Gaps

#### 1.8 Distroless Base Image Evaluation

**Current**: Node 22 Slim (Debian-based, ~80MB)
**Alternative**: gcr.io/distroless/nodejs22-debian12 (~50% smaller attack surface)

**Decision**: Document trade-offs; recommend Slim for debuggability, Distroless for high-security.

| Aspect | Slim (Current) | Distroless |
|--------|----------------|------------|
| Attack surface | Larger | Minimal |
| Shell access | Yes | No |
| Debugging | Easy | Difficult |
| Native modules | Compatible | Compatible |
| Recommendation | Development, staging | High-security production |

**Exit Criteria**: Decision documented; high-security deployments use Distroless.

---

#### 1.9 SLSA Provenance Attestation

**Gap**: No build provenance. Cannot verify image was built from trusted source.

**Decision**: Generate SLSA Level 3 provenance with GitHub Actions.

**Implementation**:
```yaml
# .github/workflows/ci.yml
- name: Build and Push with Provenance
  uses: docker/build-push-action@v5
  with:
    context: .
    push: true
    tags: ghcr.io/${{ github.repository }}/graphql:${{ github.sha }}
    provenance: true
    sbom: true
```

**Exit Criteria**: All images have SLSA provenance attestation.

---

## Part 2: GraphQL API Security

### Current Implementation (What We Have)

| Control | Status | Configuration |
|---------|--------|---------------|
| Query depth limiting | ✅ Implemented | 5 (prod), 7 (staging), 10 (dev) |
| Query complexity analysis | ✅ Implemented | 100 (prod), 200 (staging), 1000 (dev) |
| Batch request limiting | ✅ Implemented | 2 (prod), 5 (staging), 10 (dev) |
| Introspection disabled | ✅ Implemented | Disabled in prod/staging |
| Field suggestions disabled | ✅ Implemented | Disabled in prod/staging |
| Error masking | ✅ Implemented | Enabled in prod/staging |
| Alias limiting | ✅ Implemented | 5 (prod), 10 (staging), 50 (dev) |
| CORS configuration | ✅ Implemented | Environment-aware |
| Security headers | ✅ Implemented | HSTS, CSP, X-Frame-Options |

### High-Priority Gaps

#### 2.1 DataLoader for N+1 Prevention

**Gap**: Nested queries trigger multiple database round-trips.

**Decision**: Implement DataLoader via Pothos plugin.

**Implementation**:
```typescript
// apps/graphql/src/builder.ts
import DataloaderPlugin from '@pothos/plugin-dataloader';

export const builder = new SchemaBuilder<PothosTypes>({
  plugins: [PrismaPlugin, DataloaderPlugin],
  // ...
});

// apps/graphql/src/schema/types/user.ts
builder.prismaObject('User', {
  fields: (t) => ({
    // ... fields
    sessions: t.relation('sessions', {
      // DataLoader automatically batches these queries
    }),
  }),
});
```

**Package**: `@pothos/plugin-dataloader`

**Exit Criteria**: All nested relations use DataLoader; N+1 queries eliminated.

---

#### 2.2 Automatic Persisted Queries (APQ)

**Gap**: Full query strings sent on every request. No query whitelisting.

**Decision**: Enable APQ for bandwidth reduction and optional query whitelisting.

**Implementation**:
```typescript
// apps/graphql/src/index.ts
import { useAutomaticPersistedQueries } from '@graphql-yoga/plugin-apq';

const yoga = createYoga({
  schema,
  plugins: [
    useAutomaticPersistedQueries({
      store: new Map(), // Use Redis in production
    }),
  ],
});
```

**Benefits**:
- 60-80% bandwidth reduction for large queries
- Optional query whitelisting for high-security environments
- Reduced parsing overhead

**Exit Criteria**: APQ enabled; query cache hit rate >80%.

---

#### 2.3 Operation-Level Rate Limiting

**Gap**: Only global limits exist. Expensive queries not individually rate-limited.

**Decision**: Implement per-operation rate limiting via custom Envelop plugin.

**Implementation**:
```typescript
// apps/graphql/src/plugins/operation-rate-limit.ts
import { Plugin } from '@envelop/core';
import { RateLimiterMemory } from 'rate-limiter-flexible';

const limiters = {
  'Query.expensiveReport': new RateLimiterMemory({
    points: 1,
    duration: 60, // 1 per minute
  }),
  'Mutation.bulkImport': new RateLimiterMemory({
    points: 5,
    duration: 3600, // 5 per hour
  }),
};

export const useOperationRateLimit = (): Plugin => ({
  onExecute({ args }) {
    const operationName = args.operationName;
    const limiter = limiters[operationName];
    if (limiter) {
      // Rate limit logic
    }
  },
});
```

**Exit Criteria**: Expensive operations have individual rate limits.

---

#### 2.4 GraphQL Monitoring & Observability

**Gap**: No structured logging for GraphQL operations.

**Decision**: Implement OpenTelemetry tracing and structured logging.

**Implementation**:
```typescript
// apps/graphql/src/index.ts
import { useOpenTelemetry } from '@envelop/opentelemetry';
import { useSentry } from '@envelop/sentry';

const yoga = createYoga({
  schema,
  plugins: [
    useOpenTelemetry({
      resolvers: true,
      variables: false, // Don't log variables (may contain secrets)
    }),
    useSentry({
      includeRawResult: false,
      includeResolverArgs: false,
    }),
  ],
});
```

**Packages**:
- `@envelop/opentelemetry`
- `@envelop/sentry`
- `@sentry/node`

**Exit Criteria**: All operations traced; errors reported to Sentry.

---

#### 2.5 Response Caching

**Gap**: Repeated identical queries hit database every time.

**Decision**: Implement response caching with field-level TTL.

**Implementation**:
```typescript
// apps/graphql/src/index.ts
import { useResponseCache } from '@graphql-yoga/plugin-response-cache';

const yoga = createYoga({
  schema,
  plugins: [
    useResponseCache({
      session: (request) => request.headers.get('authorization'),
      ttl: 60_000, // 1 minute default
      ttlPerSchemaCoordinate: {
        'Query.products': 300_000, // 5 minutes
        'Query.product': 60_000,   // 1 minute
        'Query.me': 0,             // No cache (user-specific)
      },
      invalidateViaMutation: true,
    }),
  ],
});
```

**Exit Criteria**: Cache hit rate >60% for read queries.

---

### Medium-Priority Gaps

#### 2.6 Request Timeout Configuration

**Gap**: No explicit timeout. Queries can run indefinitely.

**Decision**: Configure request timeout at multiple layers.

**Implementation**:
```typescript
// apps/graphql/src/index.ts
import { createServer } from 'node:http';

const server = createServer(yoga);
server.timeout = 30000; // 30 seconds
server.headersTimeout = 31000;
server.keepAliveTimeout = 5000;

// Also in Yoga config
const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  // Request timeout handled by HTTP server
});
```

**Exit Criteria**: All requests timeout after 30 seconds.

---

## Part 3: Authentication Security

### Current Implementation (What We Have)

| Control | Status |
|---------|--------|
| JWT with algorithm allowlist | ✅ Implemented |
| Refresh token hashing (SHA-256) | ✅ Implemented |
| Token family tracking | ✅ Implemented |
| Token reuse detection | ✅ Implemented |
| Login rate limiting | ✅ Implemented |
| Password length validation (12-64) | ✅ Implemented |
| Common password blocklist | ✅ Implemented |
| GraphQL Armor integration | ✅ Implemented |

### Critical Gaps

#### 3.1 HIBP Breach Checking

**Gap**: Users can register with passwords found in data breaches.

**Decision**: Integrate Have I Been Pwned API for password validation.

**Implementation**:
```typescript
// packages/validation/src/hibp.ts
import crypto from 'node:crypto';

export async function isPasswordBreached(password: string): Promise<boolean> {
  const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'Add-Padding': 'true' }, // k-anonymity
  });

  const text = await response.text();
  const lines = text.split('\n');

  for (const line of lines) {
    const [hashSuffix, count] = line.split(':');
    if (hashSuffix === suffix && parseInt(count, 10) > 0) {
      return true;
    }
  }

  return false;
}

// apps/graphql/src/schema/mutations/auth.ts - In signup mutation
const isBreached = await isPasswordBreached(args.input.password);
if (isBreached) {
  throw new GraphQLError('Password found in data breach. Please choose a different password.', {
    extensions: { code: 'PASSWORD_BREACHED' },
  });
}
```

**Exit Criteria**: All registrations validated against HIBP; breached passwords rejected.

---

#### 3.2 Three-Tier Account Lockout

**Gap**: Single lockout tier (10 attempts). PRD requires 3 tiers.

**Decision**: Implement progressive lockout per PRD-AUTH specification.

**PRD Specification**:
| Threshold | Window | Lockout Duration |
|-----------|--------|------------------|
| 5 failed attempts | 15 minutes | 15 minutes |
| 10 failed attempts | 1 hour | 1 hour |
| 20 failed attempts | 24 hours | Account flagged |

**Implementation**:
```typescript
// apps/graphql/src/config/auth.ts
export const lockoutConfig = {
  tiers: [
    { attempts: 5, windowMs: 15 * 60 * 1000, lockoutMs: 15 * 60 * 1000 },
    { attempts: 10, windowMs: 60 * 60 * 1000, lockoutMs: 60 * 60 * 1000 },
    { attempts: 20, windowMs: 24 * 60 * 60 * 1000, lockoutMs: null }, // Flag for review
  ],
};

// apps/graphql/src/schema/mutations/auth.ts
async function checkLockout(email: string, ipAddress: string): Promise<LockoutResult> {
  const attempts = await prisma.loginAttempt.findMany({
    where: {
      email: email.toLowerCase(),
      success: false,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  });

  for (const tier of lockoutConfig.tiers) {
    const windowStart = Date.now() - tier.windowMs;
    const attemptsInWindow = attempts.filter(a => a.createdAt.getTime() >= windowStart);

    if (attemptsInWindow.length >= tier.attempts) {
      if (tier.lockoutMs === null) {
        // Flag account for review
        await flagAccountForReview(email);
        return { locked: true, reason: 'ACCOUNT_FLAGGED', retryAfter: null };
      }

      const lastAttempt = attemptsInWindow[0];
      const lockoutEnds = lastAttempt.createdAt.getTime() + tier.lockoutMs;

      if (Date.now() < lockoutEnds) {
        return {
          locked: true,
          reason: 'TEMPORARY_LOCKOUT',
          retryAfter: new Date(lockoutEnds),
        };
      }
    }
  }

  return { locked: false };
}
```

**Exit Criteria**: Three-tier lockout matches PRD specification exactly.

---

#### 3.3 Password Reset/Change Flows

**Gap**: No GraphQL mutations for password management.

**Decision**: Implement full password management per PRD-AUTH.

**GraphQL Schema**:
```graphql
type Mutation {
  # Existing
  signup(input: SignupInput!): AuthPayload!
  login(input: LoginInput!): AuthPayload!
  logout: Boolean!
  logoutAllDevices: Int!
  refreshToken: AuthPayload!

  # NEW - Password Management
  changePassword(input: ChangePasswordInput!): Boolean!
  requestPasswordReset(email: String!): Boolean!
  resetPassword(input: ResetPasswordInput!): AuthPayload!
}

input ChangePasswordInput {
  currentPassword: String!
  newPassword: String!
}

input ResetPasswordInput {
  token: String!
  newPassword: String!
}
```

**Database Schema Addition**:
```prisma
model PasswordResetToken {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  userId    String   @db.ObjectId
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique  // SHA-256 hash of token
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}
```

**Implementation Requirements**:
1. `changePassword`: Verify current password, validate new password (length + HIBP), revoke all other sessions
2. `requestPasswordReset`: Generate secure token, hash before storage, send email, always return success (prevent enumeration)
3. `resetPassword`: Validate token, validate new password, revoke all sessions, redirect to login

**Exit Criteria**: All password operations functional; tested in E2E suite.

---

#### 3.4 CSRF Protection

**Gap**: GraphQL mutations vulnerable to CSRF from browsers.

**Decision**: Implement double-submit cookie pattern for CSRF protection.

**Implementation**:
```typescript
// apps/graphql/src/middleware/csrf.ts
import crypto from 'node:crypto';

const CSRF_COOKIE_NAME = '__Host-csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function csrfMiddleware(request: Request, response: Response): boolean {
  // Skip for non-mutation requests (GET, OPTIONS)
  if (request.method !== 'POST') return true;

  // Skip for API clients (non-browser)
  const contentType = request.headers.get('content-type');
  if (!contentType?.includes('application/json')) return true;

  const cookieToken = getCookie(request, CSRF_COOKIE_NAME);
  const headerToken = request.headers.get(CSRF_HEADER_NAME);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return false; // CSRF validation failed
  }

  return true;
}

// Set CSRF cookie on initial page load
export function setCsrfCookie(response: Response, token: string): void {
  response.headers.set('Set-Cookie',
    `${CSRF_COOKIE_NAME}=${token}; Path=/; HttpOnly=false; Secure; SameSite=Strict`
  );
}
```

**Frontend Integration**:
```typescript
// apps/admin/src/lib/urql.ts
const fetchWithCsrf: typeof fetch = (url, options) => {
  const csrfToken = getCookie('__Host-csrf');
  return fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      'x-csrf-token': csrfToken,
    },
  });
};
```

**Exit Criteria**: All mutations protected; CSRF attacks blocked.

---

#### 3.5 Complete Error Masking

**Gap**: Rate limit and lockout errors reveal account existence.

**Current (Leaky)**:
- "Too many login attempts" → Confirms email exists
- "Account temporarily locked" → Confirms account exists

**Decision**: Unify all authentication error messages.

**Implementation**:
```typescript
// apps/graphql/src/schema/mutations/auth.ts
const AUTH_ERROR_MESSAGE = 'Invalid email or password';

// In login mutation
if (lockoutResult.locked) {
  // Log detailed info server-side
  console.warn('Login blocked', { email, reason: lockoutResult.reason, ip });

  // Return generic message to client
  throw new GraphQLError(AUTH_ERROR_MESSAGE, {
    extensions: { code: 'INVALID_CREDENTIALS' },
  });
}

if (!user || !await verifyPassword(password, user.passwordHash)) {
  throw new GraphQLError(AUTH_ERROR_MESSAGE, {
    extensions: { code: 'INVALID_CREDENTIALS' },
  });
}
```

**Exit Criteria**: All auth failures return identical error message.

---

### High-Priority Gaps

#### 3.6 Audit Logging

**Gap**: No structured logging for security events.

**Decision**: Implement comprehensive audit logging per PRD-AUTH NFR-COMP-02.

**Event Types**:
```typescript
// packages/db/src/audit.ts
export enum AuditEventType {
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILED = 'LOGIN_FAILED',
  LOGOUT = 'LOGOUT',
  TOKEN_REFRESH = 'TOKEN_REFRESH',
  TOKEN_REUSE_DETECTED = 'TOKEN_REUSE_DETECTED',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  PASSWORD_RESET_REQUEST = 'PASSWORD_RESET_REQUEST',
  PASSWORD_RESET_COMPLETE = 'PASSWORD_RESET_COMPLETE',
  ACCOUNT_LOCKOUT = 'ACCOUNT_LOCKOUT',
  SESSION_REVOKED = 'SESSION_REVOKED',
}

export interface AuditEvent {
  timestamp: Date;
  eventType: AuditEventType;
  userId?: string;
  email?: string;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  metadata?: Record<string, unknown>;
}

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  // Log to structured logging system (e.g., DataDog, ELK)
  console.log(JSON.stringify({
    ...event,
    timestamp: event.timestamp.toISOString(),
    level: 'AUDIT',
  }));

  // Optionally persist to database for compliance
  await prisma.auditLog.create({ data: event });
}
```

**Exit Criteria**: All security events logged with required fields.

---

#### 3.7 Session Listing Query

**Gap**: Users cannot view their active sessions.

**Decision**: Implement `mySessions` query per PRD-AUTH.

**Implementation**:
```typescript
// apps/graphql/src/schema/queries/auth.ts
builder.queryField('mySessions', (t) =>
  t.field({
    type: [SessionType],
    description: 'List all active sessions for the current user',
    resolve: async (_parent, _args, context) => {
      if (!context.userId) {
        throw new GraphQLError('Not authenticated');
      }

      const sessions = await prisma.session.findMany({
        where: {
          userId: context.userId,
          expiresAt: { gt: new Date() },
        },
        orderBy: { lastUsedAt: 'desc' },
      });

      return sessions.map(session => ({
        ...session,
        isCurrent: session.id === context.sessionId,
        device: parseUserAgent(session.userAgent),
        location: await geolocateIP(session.ipAddress),
      }));
    },
  })
);
```

**Exit Criteria**: Users can view and manage all sessions.

---

#### 3.8 HttpOnly Refresh Token Cookies

**Gap**: Refresh tokens returned in response body, not secure cookies.

**Decision**: Set refresh token as HttpOnly cookie per PRD-AUTH.

**Implementation**:
```typescript
// apps/graphql/src/schema/mutations/auth.ts
// In login/signup/refreshToken mutations

const refreshToken = generateRefreshToken();
const tokenHash = hashToken(refreshToken);

// Store hashed token in database
await prisma.session.create({
  data: {
    userId: user.id,
    tokenHash,
    // ...
  },
});

// Set HttpOnly cookie
context.response.headers.set('Set-Cookie', [
  `__Host-refresh_token=${refreshToken}`,
  'Path=/',
  'HttpOnly',
  'Secure',
  'SameSite=Strict',
  `Max-Age=${7 * 24 * 60 * 60}`, // 7 days
].join('; '));

// Return only access token in response body
return {
  accessToken,
  user,
};
```

**Exit Criteria**: Refresh tokens never exposed to JavaScript.

---

#### 3.9 Signup Rate Limiting Enforcement

**Gap**: Rate limit config exists but not enforced in signup mutation.

**Decision**: Enforce signup rate limiting.

**Implementation**:
```typescript
// apps/graphql/src/schema/mutations/auth.ts
builder.mutationField('signup', (t) =>
  t.field({
    // ...
    resolve: async (_parent, args, context) => {
      // ADD: Rate limit check
      const rateLimitResult = await checkSignupRateLimit(context.ipAddress);
      if (rateLimitResult.limited) {
        throw new GraphQLError('Too many registration attempts. Please try again later.', {
          extensions: {
            code: 'RATE_LIMITED',
            retryAfter: rateLimitResult.retryAfter,
          },
        });
      }

      // Existing signup logic...
    },
  })
);
```

**Exit Criteria**: Signup limited to 3 requests per hour per IP.

---

## Part 4: CI/CD & Secrets Management

### Current Implementation (What We Have)

| Control | Status |
|---------|--------|
| GitHub Actions CI (lint, typecheck, test) | ✅ Implemented |
| ArgoCD GitOps deployment | ✅ Documented |
| GitHub Secrets for credentials | ✅ Implemented |

### Critical Gaps

#### 4.1 Secret Rotation Strategy

**Gap**: Static secrets with no rotation mechanism.

**Decision**: Implement automated secret rotation via HashiCorp Vault.

**Vault Configuration**:
```hcl
# vault/policies/graphql.hcl
path "secret/data/graphql/*" {
  capabilities = ["read"]
}

path "database/creds/graphql-app" {
  capabilities = ["read"]
}
```

**Rotation Schedule**:
| Secret | Rotation Period | Method |
|--------|-----------------|--------|
| JWT_SECRET | 90 days | Manual rotation with key versioning |
| DATABASE_URL | 30 days | Dynamic credentials via Vault |
| API keys | 90 days | Automated via Vault |

**Exit Criteria**: All secrets rotate automatically; zero static credentials.

---

#### 4.2 Secret Scanning in CI

**Gap**: No detection of committed secrets.

**Decision**: Add TruffleHog scanning to CI pipeline.

**Implementation**:
```yaml
# .github/workflows/ci.yml
- name: Secret Scanning
  uses: trufflesecurity/trufflehog@main
  with:
    path: ./
    base: ${{ github.event.repository.default_branch }}
    head: HEAD
    extra_args: --only-verified
```

**Exit Criteria**: PRs with secrets automatically blocked.

---

#### 4.3 SAST Scanning (CodeQL)

**Gap**: No source code vulnerability detection.

**Decision**: Enable GitHub CodeQL analysis.

**Implementation**:
```yaml
# .github/workflows/codeql.yml
name: CodeQL Analysis

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1' # Weekly

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: typescript

      - name: Build
        run: pnpm install && pnpm build

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
```

**Exit Criteria**: All PRs pass CodeQL security checks.

---

### High-Priority Gaps

#### 4.4 Dependency Vulnerability Scanning

**Gap**: No explicit npm audit in CI.

**Decision**: Add npm audit with Snyk integration.

**Implementation**:
```yaml
# .github/workflows/ci.yml
- name: Dependency Audit
  run: pnpm audit --audit-level=moderate

- name: Snyk Vulnerability Scan
  uses: snyk/actions/node@master
  env:
    SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
  with:
    args: --severity-threshold=high
```

**Exit Criteria**: High/critical vulnerabilities block deployment.

---

#### 4.5 Deployment Approval Workflows

**Gap**: No manual approval for production deployments.

**Decision**: Implement tiered approval workflow.

| Environment | Approval Required | Approvers |
|-------------|-------------------|-----------|
| Development | None (auto-sync) | - |
| Staging | None (auto-sync) | - |
| Production | Yes (2 approvers) | Engineering Lead + SRE |

**ArgoCD Configuration**:
```yaml
# argocd/applications/graphql-prod.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: graphql-prod
spec:
  syncPolicy:
    automated: null  # Manual sync required
  # ...
```

**Exit Criteria**: Production deployments require explicit approval.

---

#### 4.6 Rollback Procedures

**Gap**: No documented rollback process.

**Decision**: Document and automate rollback procedures.

**Automatic Rollback Triggers**:
- Error rate > 5% (measured by Prometheus)
- Response latency p99 > 2000ms
- Pod crash loop (CrashLoopBackOff > 3)

**Manual Rollback Commands**:
```bash
# Kubernetes rollback
kubectl rollout undo deployment/graphql-api -n production

# GitOps rollback (revert commit)
git revert <commit-hash>
git push origin main

# ArgoCD rollback to specific revision
argocd app rollback graphql-prod <revision>
```

**Exit Criteria**: Rollback procedures documented and tested.

---

#### 4.7 Branch Protection Rules

**Gap**: No documented branch protection.

**Decision**: Enforce branch protection on main.

**Required Rules**:
```yaml
Branch: main
  Require pull request:
    Required approvals: 1
    Dismiss stale reviews: true
    Require review from code owners: true

  Require status checks:
    - lint
    - typecheck
    - test
    - security-scan

  Require signed commits: true

  Restrict pushes:
    - Allow: CI service account only
```

**Exit Criteria**: Direct pushes to main blocked; PRs require approval.

---

## Part 5: MongoDB/Database Security

### Current Implementation (What We Have)

| Control | Status |
|---------|--------|
| Replica set configuration | ✅ Implemented (dev) |
| Prisma singleton pattern | ✅ Implemented |
| Docker volume persistence | ✅ Implemented (dev) |

**Note**: Current setup is explicitly for local development only.

### Critical Gaps

#### 5.1 Authentication

**Gap**: No authentication configured.

**Decision**: Enable SCRAM-SHA-256 authentication for all environments.

**Development** (docker-compose.yml):
```yaml
services:
  mongodb:
    image: mongo:7
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: ${MONGODB_ADMIN_PASSWORD}
    command: --replSet rs0 --bind_ip_all --auth --keyFile /etc/mongodb/keyfile
    volumes:
      - mongodb_data:/data/db
      - ./mongodb/keyfile:/etc/mongodb/keyfile:ro
```

**Application User** (created via init script):
```javascript
db.createUser({
  user: "octant_app",
  pwd: "APPLICATION_PASSWORD",
  roles: [
    { role: "readWrite", db: "octant" },
    { role: "readWrite", db: "octant_test" }
  ]
});
```

**Connection String**:
```
mongodb://octant_app:PASSWORD@localhost:27018/octant?replicaSet=rs0&authSource=admin
```

**Exit Criteria**: All MongoDB connections require authentication.

---

#### 5.2 TLS/SSL Encryption

**Gap**: Data transmitted unencrypted.

**Decision**: Require TLS for all MongoDB connections.

**Certificate Generation** (development):
```bash
# Generate self-signed cert for development
openssl req -newkey rsa:4096 -nodes -keyout mongodb.key \
  -x509 -days 365 -out mongodb.crt \
  -subj "/CN=mongodb"
cat mongodb.key mongodb.crt > mongodb.pem
```

**Docker Compose Update**:
```yaml
services:
  mongodb:
    command: >
      --replSet rs0
      --bind_ip_all
      --auth
      --keyFile /etc/mongodb/keyfile
      --tlsMode requireTLS
      --tlsCertificateKeyFile /etc/mongodb/mongodb.pem
```

**Connection String**:
```
mongodb://user:pass@localhost:27018/octant?replicaSet=rs0&authSource=admin&tls=true&tlsCAFile=/path/to/ca.pem
```

**Exit Criteria**: All connections encrypted with TLS 1.2+.

---

#### 5.3 Encryption at Rest

**Gap**: Data stored unencrypted on disk.

**Decision**: Enable WiredTiger encryption at rest.

**For Self-Hosted** (Enterprise feature or Percona Server):
```yaml
security:
  encryption:
    encryptionCipherMode: AES256-CBC
    encryptionKeyFile: /etc/mongodb/encryption-key
```

**For MongoDB Atlas** (Recommended):
- Encryption at rest enabled by default
- Customer-managed keys via AWS KMS/Azure Key Vault available

**Exit Criteria**: All data encrypted at rest.

---

#### 5.4 Network Access Controls

**Gap**: MongoDB bound to all interfaces.

**Decision**: Restrict network access per environment.

**Development**:
```yaml
# docker-compose.yml
services:
  mongodb:
    ports:
      - "127.0.0.1:27018:27017"  # Localhost only
```

**Production (Kubernetes)**:
```yaml
# Network policy restricting MongoDB access
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: mongodb-access
spec:
  podSelector:
    matchLabels:
      app: mongodb
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: graphql-api
        - podSelector:
            matchLabels:
              app: rest-api
      ports:
        - port: 27017
```

**Exit Criteria**: MongoDB accessible only from application pods.

---

#### 5.5 Backup and Disaster Recovery

**Gap**: No backup strategy documented.

**Decision**: Implement 3-2-1 backup strategy.

**Backup Strategy**:
| Type | Frequency | Retention | Storage |
|------|-----------|-----------|---------|
| Full (mongodump) | Daily | 30 days | S3/GCS |
| Incremental (oplog) | Continuous | 7 days | S3/GCS |
| Point-in-time recovery | - | 7 days | Oplog replay |

**Backup Script**:
```bash
#!/bin/bash
# scripts/backup-mongodb.sh

BACKUP_DIR="/backups/mongodb"
DATE=$(date +%Y%m%d_%H%M%S)
S3_BUCKET="s3://mycompany-backups/mongodb"

# Full backup with oplog
mongodump \
  --uri="$DATABASE_URL" \
  --oplog \
  --archive="${BACKUP_DIR}/mongodb-${DATE}.archive" \
  --gzip

# Upload to S3
aws s3 cp "${BACKUP_DIR}/mongodb-${DATE}.archive" "${S3_BUCKET}/"

# Clean up old local backups
find "${BACKUP_DIR}" -type f -mtime +7 -delete
```

**Recovery Procedure**:
```bash
# Restore from backup
mongorestore \
  --uri="$DATABASE_URL" \
  --oplogReplay \
  --archive=/backups/mongodb-20260115.archive \
  --gzip
```

**Exit Criteria**: Daily backups verified; recovery tested quarterly.

---

### High-Priority Gaps

#### 5.6 Audit Logging

**Gap**: No database-level audit logging.

**Decision**: Enable MongoDB audit logging (Enterprise/Percona).

**Configuration**:
```yaml
auditLog:
  destination: file
  format: JSON
  path: /var/log/mongodb/audit.json
  filter: '{ atype: { $in: ["authenticate", "authCheck", "createUser", "dropUser", "dropDatabase", "dropCollection"] } }'
```

**Exit Criteria**: All authentication and schema changes logged.

---

#### 5.7 RBAC with Minimum Privileges

**Gap**: Application uses admin credentials.

**Decision**: Create least-privilege application user.

**User Roles**:
| User | Role | Database | Purpose |
|------|------|----------|---------|
| admin | root | admin | Administration only |
| octant_app | readWrite | octant | Application operations |
| octant_backup | backup | admin | Backup operations |
| octant_monitor | clusterMonitor | admin | Monitoring only |

**Exit Criteria**: Application user has only required permissions.

---

### Medium-Priority Gaps

#### 5.8 Connection Pool Security

**Gap**: No explicit connection pool configuration.

**Decision**: Configure connection pool for production workloads.

**Connection String Parameters**:
```
mongodb://user:pass@host:27017/octant?
  replicaSet=rs0&
  authSource=admin&
  tls=true&
  maxPoolSize=50&
  minPoolSize=10&
  maxIdleTimeMS=60000&
  serverSelectionTimeoutMS=5000&
  socketTimeoutMS=45000&
  connectTimeoutMS=10000
```

**Exit Criteria**: Connection pool tuned for production load.

---

#### 5.9 Query Timeout Configuration

**Gap**: No query timeout limits.

**Decision**: Implement query timeouts at application level.

**Prisma Middleware**:
```typescript
// packages/db/src/middleware/timeout.ts
prisma.$use(async (params, next) => {
  const timeout = 30000; // 30 seconds

  const result = await Promise.race([
    next(params),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Database query timeout')), timeout)
    ),
  ]);

  return result;
});
```

**Exit Criteria**: All queries timeout after 30 seconds.

---

#### 5.10 Data Retention Policies

**Gap**: No data lifecycle management.

**Decision**: Implement TTL indexes for ephemeral data.

**Prisma Schema Updates**:
```prisma
model LoginAttempt {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  email     String
  ipAddress String
  success   Boolean
  createdAt DateTime @default(now())

  @@index([createdAt], map: "createdAt_ttl")
}

model PasswordResetToken {
  // ... fields
  createdAt DateTime @default(now())

  @@index([createdAt], map: "createdAt_ttl")
}
```

**MongoDB TTL Index** (run after db:push):
```javascript
// Create TTL index for LoginAttempt (30 days)
db.LoginAttempt.createIndex(
  { "createdAt": 1 },
  { expireAfterSeconds: 2592000 }
);

// Create TTL index for PasswordResetToken (1 hour)
db.PasswordResetToken.createIndex(
  { "createdAt": 1 },
  { expireAfterSeconds: 3600 }
);
```

**Exit Criteria**: Ephemeral data automatically purged.

---

## Implementation Roadmap

### Phase 1: Critical Security (Weeks 1-2)

**Exit Criteria**: Pass security checklist for critical items.

| Task | Domain | Priority | Effort |
|------|--------|----------|--------|
| Add Trivy container scanning | Container | Critical | 2h |
| Enable MongoDB authentication | Database | Critical | 4h |
| Configure MongoDB TLS | Database | Critical | 4h |
| Implement HIBP breach checking | Auth | Critical | 4h |
| Fix 3-tier account lockout | Auth | Critical | 2h |
| Add secret scanning (TruffleHog) | CI/CD | Critical | 1h |
| Complete error masking | Auth | Critical | 1h |

### Phase 2: Token & Session Security (Weeks 3-4)

**Exit Criteria**: Tokens secure against XSS and replay attacks.

| Task | Domain | Priority | Effort |
|------|--------|----------|--------|
| Implement password reset/change | Auth | Critical | 8h |
| Add HttpOnly refresh token cookies | Auth | High | 4h |
| Implement session listing query | Auth | High | 4h |
| Enforce signup rate limiting | Auth | High | 2h |
| Implement CSRF protection | Auth | Critical | 4h |
| Add audit logging | Auth | High | 6h |

### Phase 3: Production Hardening (Weeks 5-6)

**Exit Criteria**: Pass CIS benchmarks for Docker and Kubernetes.

| Task | Domain | Priority | Effort |
|------|--------|----------|--------|
| Generate SBOM in CI | Container | Critical | 2h |
| Implement image signing | Container | Critical | 4h |
| Enable read-only root filesystem | Container | Critical | 2h |
| Add K8s security context | Container | Critical | 2h |
| Implement network policies | Container | Critical | 4h |
| Deploy External Secrets Operator | CI/CD | High | 8h |

### Phase 4: Observability & Performance (Weeks 7-8)

**Exit Criteria**: Full observability stack operational.

| Task | Domain | Priority | Effort |
|------|--------|----------|--------|
| Add DataLoader for N+1 | GraphQL | High | 4h |
| Implement APQ | GraphQL | High | 4h |
| Add response caching | GraphQL | Medium | 4h |
| Implement GraphQL monitoring | GraphQL | High | 6h |
| Configure request timeouts | GraphQL | Medium | 2h |
| Add Sentry integration | GraphQL | High | 2h |

### Phase 5: Compliance & Documentation (Weeks 9-10)

**Exit Criteria**: Production readiness review passed.

| Task | Domain | Priority | Effort |
|------|--------|----------|--------|
| Enable CodeQL analysis | CI/CD | High | 2h |
| Add dependency scanning | CI/CD | High | 2h |
| Configure branch protection | CI/CD | Medium | 1h |
| Document deployment approvals | CI/CD | High | 2h |
| Document rollback procedures | CI/CD | High | 4h |
| Implement MongoDB backups | Database | Critical | 8h |
| Add MongoDB audit logging | Database | High | 4h |
| Configure data retention | Database | Medium | 4h |

---

## Consequences

### Positive

- **Security Posture**: From ~29% to >90% compliance with 2026 standards
- **Compliance**: Meet OWASP, NIST, CIS benchmark requirements
- **Incident Response**: Full audit trail for forensics
- **Supply Chain**: Verified images with SBOM and provenance
- **Zero Trust**: Network segmentation and least-privilege access
- **Resilience**: Automated backups and tested recovery procedures

### Negative

- **Complexity**: More infrastructure components to manage
- **Cost**: HashiCorp Vault, monitoring tools, backup storage
- **Performance**: Some overhead from encryption and logging
- **Development**: Stricter CI/CD may slow initial iterations

### Trade-offs

- We accept increased complexity for production security
- We accept some performance overhead for encryption at rest
- We prioritize security over development velocity

---

## Acceptance Criteria

### Pre-Production Checklist

#### Container Security
- [ ] All images scanned with Trivy; zero critical/high CVEs
- [ ] SBOM generated for every production image
- [ ] Images signed with Cosign; verified by cluster policy
- [ ] All pods run with read-only root filesystem
- [ ] Security context applied (non-root, capabilities dropped, seccomp)
- [ ] Network policies enforce default-deny

#### GraphQL Security
- [ ] DataLoader prevents N+1 queries
- [ ] APQ enabled with >80% cache hit rate
- [ ] Response caching configured with appropriate TTLs
- [ ] All operations traced in OpenTelemetry
- [ ] Errors reported to Sentry

#### Authentication Security
- [ ] HIBP breach checking blocks compromised passwords
- [ ] 3-tier lockout matches PRD specification
- [ ] Password reset/change flows functional
- [ ] CSRF protection active on all mutations
- [ ] All auth errors return identical message
- [ ] Audit logging captures all security events
- [ ] Session management (list, revoke) functional
- [ ] Refresh tokens in HttpOnly cookies

#### CI/CD Security
- [ ] Secret scanning blocks PRs with credentials
- [ ] CodeQL analysis passes on all PRs
- [ ] Dependency audit blocks high/critical CVEs
- [ ] Branch protection requires approval
- [ ] Production deployments require manual approval
- [ ] Rollback procedures documented and tested

#### Database Security
- [ ] MongoDB authentication enabled
- [ ] TLS encryption for all connections
- [ ] Encryption at rest enabled
- [ ] Network access restricted to application pods
- [ ] Daily backups with tested recovery
- [ ] Audit logging enabled
- [ ] Application user has minimum privileges
- [ ] TTL indexes configured for ephemeral data

---

## References

### Standards & Guidelines
- [OWASP Top 10 (2025)](https://owasp.org/Top10/)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP GraphQL Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html)
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [NIST SP 800-190 Container Security](https://csrc.nist.gov/publications/detail/sp/800-190/final)
- [RFC 8725 JWT Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725)
- [CIS Docker Benchmark](https://www.cisecurity.org/benchmark/docker)
- [CIS Kubernetes Benchmark](https://www.cisecurity.org/benchmark/kubernetes)

### Tools Documentation
- [Trivy Container Scanner](https://trivy.dev/)
- [Cosign/Sigstore](https://docs.sigstore.dev/)
- [External Secrets Operator](https://external-secrets.io/)
- [GraphQL Armor](https://the-guild.dev/graphql/armor)
- [Pothos DataLoader Plugin](https://pothos-graphql.dev/docs/plugins/dataloader)
- [MongoDB Security Checklist](https://www.mongodb.com/docs/manual/administration/security-checklist/)

### Internal References
- [ADR-000: Turborepo Monorepo Template](./ADR-000-turborepo-monorepo-template.md)
- [ADR-002: Prisma MongoDB Setup](./ADR-002-prisma-mongodb-setup.md)
- [ADR-004: GraphQL API Architecture](./ADR-004-graphql-api-architecture.md)
- [PRD-AUTH: Authentication System](../PRD-AUTH.md)
- [DOCKER-K8S-DEPLOYMENT](../DOCKER-K8S-DEPLOYMENT.md)

---

*Document Version History:*
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2026-01-15 | Security Audit | Initial draft from 5-agent security analysis |
