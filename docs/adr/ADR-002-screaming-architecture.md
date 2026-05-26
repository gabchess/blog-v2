# ADR-002: Screaming Architecture

## Status
Accepted (with caveats - see Implementation Reality section)

## Context

We needed to decide how to organize the codebase. Traditional approaches organize code by technical layer (controllers, services, repositories, utils), which makes it hard to understand what the system actually does without deep exploration.

We want:
- New developers to understand the business purpose within 5 minutes
- Framework changes to have minimal blast radius
- Domain logic to be testable without infrastructure
- Code organization to communicate intent, not implementation

## Decision

We adopt **Screaming Architecture** as described by Uncle Bob Martin. The top-level directory structure should "scream" what the application is about, not what frameworks it uses.

### Key Principles

1. **Domain First**: Top-level folders describe business concepts, not technical layers

2. **Use Cases Drive Structure**: Each module is organized around what it does, not how it does it

3. **Framework Agnosticism**: Domain logic in `packages/` has zero framework dependencies

4. **The Litmus Test**: A new developer should identify the business domain within 5 minutes

### Actual Structure (Corrected)

```
├── packages/           # Shared infrastructure (currently technical, not domain)
│   ├── db/             # Prisma client + schema (defines domain entities)
│   └── validation/     # Zod schemas (auto-generated from Prisma)
│
├── apps/               # Delivery mechanisms (framework-specific)
│   ├── admin/          # Admin dashboard (React + urql)
│   ├── api/            # REST API (Node.js HTTP server)
│   ├── graphql/        # GraphQL API (Pothos + Yoga)
│   └── web/            # Customer-facing app (React)
```

**Domain entities defined in `packages/db/prisma/schema.prisma`:**
- User, Session, LoginAttempt (authentication domain)

**Feature-driven structure within apps:**
- `apps/admin/src/features/auth/` - authentication (login, signup)
- `apps/admin/src/features/profile/` - user profile management
- `apps/graphql/src/schema/types/` - domain types (user, session)

## Implementation Reality

### What Screams
- **Inside apps**: Feature folders (`features/auth/`, `features/profile/`) clearly communicate domain
- **Prisma schema**: Domain entities (User, Session, LoginAttempt) are visible and well-documented
- **GraphQL types**: Organized by domain entity, not by technical concern

### What Doesn't Scream (Yet)
- **Top-level apps**: Named by technology (`api`, `graphql`, `web`, `admin`), not domain purpose
- **Packages**: Named by technology (`db`, `validation`), not business capability
- **Root glance test**: A new developer sees "this is a TypeScript monorepo" not "this is an authenticated app"

### The 5-Minute Test: Current Score
A new developer looking at the repo root would:
1. See `apps/` and `packages/` - knows it's a monorepo (1 min)
2. Must open `packages/db/prisma/schema.prisma` to discover domain entities (2 min)
3. Must explore `apps/admin/src/features/` to see business capabilities (3 min)
4. Understands "authenticated application with user management" (4 min)

**Verdict**: Passes, but barely. Domain visibility requires exploration.

## Consequences

### Positive
- Codebase reveals its purpose at the feature level (inside apps)
- Framework swaps are localized to specific apps
- Domain types (Prisma models) are reusable across all apps
- Tests can focus on behavior without infrastructure setup
- Onboarding is faster once you reach feature folders

### Negative
- Requires discipline to avoid "utils" catch-all folders
- Some code duplication vs. extracting technical abstractions
- Team must agree on domain vocabulary
- Top-level structure screams "technology" not "domain"

### Trade-offs
- We accept some duplication in exchange for clarity
- We prioritize understandability over DRY optimization
- We keep framework code contained rather than abstracted away

## Modern Standards Alignment (2026)

### Industry Best Practices

Based on current standards from [Clean Architecture guides](https://www.milanjovanovic.tech/blog/clean-architecture-folder-structure), [Feature-Sliced Design](https://feature-sliced.design/blog/frontend-monorepo-explained), and [Turborepo documentation](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository):

| Principle | Current State | Modern Standard | Gap |
|-----------|--------------|-----------------|-----|
| **Domain visibility** | Visible at feature level | Visible at root | Medium |
| **Layered architecture** | Implicit via packages | Explicit Domain/Application/Infrastructure | Medium |
| **Feature folders** | Used in admin app | Recommended everywhere | Aligned |
| **Shared types** | Via Prisma generation | Explicit types package | Aligned |
| **Framework isolation** | Apps contain framework code | Frameworks in infrastructure layer | Aligned |

### Recommendations for Full Alignment

1. **Consider renaming packages to reflect domain:**
   ```
   packages/
   ├── catalog/        # Product domain logic (instead of just validation)
   ├── identity/       # User/Session domain logic
   └── infrastructure/ # Database, external services
   ```

2. **Consider domain-scoped apps:**
   ```
   apps/
   ├── storefront/     # Customer-facing (instead of web)
   ├── backoffice/     # Admin interface (instead of admin)
   └── gateway/        # API layer (combines api + graphql)
   ```

3. **Add a domain layer package:**
   - Pure TypeScript with zero dependencies
   - Contains business rules, not just types
   - Referenced by all apps

4. **Document domain boundaries:**
   - Create a domain glossary in `/docs`
   - Define bounded contexts if the system grows

### Scalability Considerations

| Team Size | Current Structure | Recommendation |
|-----------|------------------|----------------|
| 1-3 devs | Sufficient | Keep simple |
| 4-10 devs | May need more explicit boundaries | Add domain packages |
| 10+ devs | Feature teams need clear ownership | Consider modular monolith pattern |

### References

- [Uncle Bob's Screaming Architecture](https://blog.cleancoder.com/uncle-bob/2011/09/30/Screaming-Architecture.html)
- [Milan Jovanovic's Clean Architecture Guide](https://www.milanjovanovic.tech/blog/clean-architecture-folder-structure)
- [React Folder Structure Evolution](https://profy.dev/article/react-folder-structure)
- [Turborepo Repository Structure](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository)
- [Feature-Sliced Design for Monorepos](https://feature-sliced.design/blog/frontend-monorepo-explained)
