# ADR-008: Full Stack Feature Workflow

## Status
Accepted

## Context

New developers need a clear, step-by-step reference for implementing features across all layers of the monorepo. This ADR documents the canonical workflow from database schema to frontend components.

**Target audience**: Developers who understand the individual technologies but need to know how they connect in this specific codebase.

---

## Decision

We adopt a **layer-by-layer workflow** where changes flow from the database upward:

```
schema.prisma (source of truth)
    │
    ├─► Prisma Client (database operations)
    ├─► Zod Schemas (validation - auto-generated + manual)
    └─► Pothos Types (GraphQL schema)
           │
           ├─► GraphQL Types (builder.prismaObject)
           ├─► GraphQL Queries (t.prismaField)
           └─► GraphQL Mutations (Zod validation)
                  │
                  └─► Frontend (URQL + React)
```

---

## Layer 1: Database Schema

**File:** `packages/db/prisma/schema.prisma`

### Add Your Model

```prisma
model Post {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  userId    String   @db.ObjectId
  user      User     @relation(fields: [userId], references: [id])
  title     String
  content   String
  published Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
}

// Add relation to User
model User {
  // ...existing fields
  posts Post[]
}
```

### Regenerate Everything

```bash
pnpm db:push
```

This single command:
1. Syncs schema to MongoDB
2. Regenerates Prisma client types
3. Regenerates Zod schemas in `packages/validation/src/generated/`
4. Regenerates Pothos types

---

## Layer 2: Validation Schemas

**File:** `packages/validation/src/index.ts`

### What's Auto-Generated

The `prisma-zod-generator` creates schemas in `src/generated/`:
- `PostPureType` - Complete model validation
- `PostInputType` - Input validation for create/update

These are re-exported automatically via:
```typescript
export * from './generated/schemas/variants/pure/index';
export * from './generated/schemas/variants/input/index';
```

### When to Add Manual Schemas

Add hand-written schemas when you need **business rules** beyond type validation:

```typescript
// packages/validation/src/index.ts

export const CreatePostInputSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title must be 200 characters or less'),
  content: z.string()
    .min(1, 'Content is required')
    .max(50000, 'Content must be 50,000 characters or less'),
  published: z.boolean().optional(),
});

export type CreatePostInput = z.infer<typeof CreatePostInputSchema>;
```

---

## Layer 3: GraphQL Type Definition

**File:** `apps/graphql/src/schema/types/post.ts`

```typescript
import { builder } from '../../builder.js';

builder.prismaObject('Post', {
  description: 'A blog post',
  fields: (t) => ({
    id: t.exposeID('id'),
    title: t.exposeString('title'),
    content: t.exposeString('content'),
    published: t.exposeBoolean('published'),
    createdAt: t.expose('createdAt', { type: 'Date' }),
    updatedAt: t.expose('updatedAt', { type: 'Date' }),

    // Relation with authorization
    user: t.relation('user', {
      description: 'Post author',
    }),
  }),
});
```

### Field-Level Authorization

For sensitive fields, add `authScopes`:

```typescript
// Only post owner can see draft status
drafts: t.relation('drafts', {
  authScopes: (parent, _args, context) => {
    return context.currentUser?.id === parent.userId;
  },
}),
```

---

## Layer 4: GraphQL Queries

**File:** `apps/graphql/src/schema/queries/post.ts`

```typescript
import { prisma } from '@octant/db';
import { builder } from '../../builder.js';

// Public query - anyone can see published posts
builder.queryField('posts', (t) =>
  t.prismaField({
    type: ['Post'],
    description: 'Get all published posts',
    skipTypeScopes: true,  // PUBLIC
    resolve: (query) =>
      prisma.post.findMany({
        ...query,
        where: { published: true },
        orderBy: { createdAt: 'desc' },
      }),
  })
);

// Authenticated query - user's own posts
builder.queryField('myPosts', (t) =>
  t.prismaField({
    type: ['Post'],
    description: 'Get current user posts',
    // Inherits auth from root Query type
    resolve: (query, _parent, _args, context) =>
      prisma.post.findMany({
        ...query,
        where: { userId: context.currentUser!.id },
        orderBy: { createdAt: 'desc' },
      }),
  })
);
```

### Key Patterns

| Pattern | Usage |
|---------|-------|
| `skipTypeScopes: true` | Make query public (no auth required) |
| `context.currentUser!.id` | Safe because root Query requires auth |
| `...query` spread | Prisma optimization from Pothos |

---

## Layer 5: GraphQL Mutations

**File:** `apps/graphql/src/schema/mutations/post.ts`

```typescript
import { prisma } from '@octant/db';
import { CreatePostInputSchema } from '@octant/validation';
import { builder } from '../../builder.js';

// Input type
const CreatePostInput = builder.inputType('CreatePostInput', {
  fields: (t) => ({
    title: t.string({ required: true }),
    content: t.string({ required: true }),
    published: t.boolean({ required: false }),
  }),
});

// Create mutation
builder.mutationField('createPost', (t) =>
  t.prismaField({
    type: 'Post',
    description: 'Create a new post',
    args: {
      input: t.arg({ type: CreatePostInput, required: true }),
    },
    // Inherits auth from root Mutation type
    resolve: async (query, _parent, args, context) => {
      // 1. Validate with Zod
      const validated = CreatePostInputSchema.parse(args.input);

      // 2. Create in database
      const post = await prisma.post.create({
        ...query,
        data: {
          ...validated,
          userId: context.currentUser!.id,
        },
      });

      return post;
    },
  })
);

// Delete mutation with ownership check
builder.mutationField('deletePost', (t) =>
  t.field({
    type: 'Boolean',
    description: 'Delete a post (owner only)',
    args: {
      id: t.arg.string({ required: true }),
    },
    resolve: async (_parent, args, context) => {
      // 1. Fetch post
      const post = await prisma.post.findUnique({
        where: { id: args.id },
      });

      // 2. IDOR prevention - verify ownership
      if (!post || post.userId !== context.currentUser!.id) {
        throw new Error('Post not found');  // Generic error
      }

      // 3. Delete
      await prisma.post.delete({ where: { id: args.id } });

      return true;
    },
  })
);
```

### Key Patterns

| Pattern | Purpose |
|---------|---------|
| `CreatePostInputSchema.parse()` | Zod validation with business rules |
| `context.currentUser!.id` | Get authenticated user ID |
| Ownership check before delete | IDOR prevention |
| Generic error messages | Prevent information leakage |

---

## Layer 6: Register in Schema

**File:** `apps/graphql/src/schema/index.ts`

```typescript
// Add imports for new entity
import './types/post.js';
import './queries/post.js';
import './mutations/post.js';
```

---

## Layer 7: Frontend Integration

**File:** `apps/admin/src/graphql/queries.ts`

```typescript
import { gql } from 'urql';

export const MY_POSTS_QUERY = gql`
  query MyPosts {
    myPosts {
      id
      title
      published
      createdAt
    }
  }
`;

export const CREATE_POST_MUTATION = gql`
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      id
      title
      content
      published
    }
  }
`;
```

**File:** `apps/admin/src/features/posts/PostList.tsx`

```typescript
import { useQuery, useMutation } from 'urql';
import { MY_POSTS_QUERY, CREATE_POST_MUTATION } from '../../graphql/queries';

export function PostList() {
  const [{ data, fetching }] = useQuery({ query: MY_POSTS_QUERY });
  const [, createPost] = useMutation(CREATE_POST_MUTATION);

  const handleCreate = async (input: { title: string; content: string }) => {
    const result = await createPost({ input });
    if (result.error) {
      console.error(result.error);
    }
  };

  if (fetching) return <div>Loading...</div>;

  return (
    <ul>
      {data?.myPosts?.map((post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  );
}
```

---

## Commands Reference

| Command | Purpose |
|---------|---------|
| `pnpm db:push` | Sync schema + regenerate all types |
| `pnpm db:studio` | Open Prisma Studio GUI |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Verify TypeScript |
| `pnpm test` | Run unit tests |
| `pnpm test:db` | Run E2E tests with database |
| `pnpm dev` | Start all services in watch mode |

---

## Security Checklist

Before shipping a new feature:

- [ ] **Auth scopes**: Sensitive fields have `authScopes` callbacks
- [ ] **Input validation**: Mutations validate with Zod schemas
- [ ] **IDOR prevention**: Ownership verified before update/delete
- [ ] **Error messages**: No user existence or data leakage
- [ ] **Audit logging**: Security-relevant operations logged (optional)

---

## Type Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│  packages/db/prisma/schema.prisma                           │
│  SINGLE SOURCE OF TRUTH                                     │
└─────────────────────────────────────────────────────────────┘
                    │
                    │ pnpm db:push
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
┌────────┐    ┌──────────┐    ┌──────────┐
│ Prisma │    │   Zod    │    │  Pothos  │
│ Client │    │ Schemas  │    │  Types   │
└────────┘    └──────────┘    └──────────┘
    │               │               │
    │               │               │
    ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│  apps/graphql                                                │
│  ├── Prisma for DB operations                               │
│  ├── Zod for mutation validation                            │
│  └── Pothos for type-safe GraphQL schema                    │
└─────────────────────────────────────────────────────────────┘
                    │
                    │ GraphQL API
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  apps/admin (or apps/web)                                    │
│  ├── URQL GraphQL client                                    │
│  └── React components                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Consequences

### Positive

- **Single source of truth**: Schema changes cascade through all layers
- **Type safety**: End-to-end from database to frontend
- **Consistent patterns**: Every feature follows the same workflow
- **Security by default**: Auth required unless explicitly public

### Negative

- **Generation step**: Must run `pnpm db:push` after schema changes
- **Multiple files**: Each feature touches 5-7 files across layers
- **Learning curve**: Understanding the full flow takes time

---

## Related ADRs

- [ADR-003](./ADR-003-prisma-mongodb-setup.md) - Prisma and MongoDB setup
- [ADR-004](./ADR-004-graphql-api-architecture.md) - GraphQL API architecture
- [ADR-005](./ADR-005-graphql-authentication-token-strategy-csrf.md) - Authentication and CSRF
- [ADR-006](./ADR-006-graphql-authentication-authorization.md) - Authorization patterns
