# @octant/admin

Admin dashboard for the Octant platform built with React, Vite, and urql GraphQL client.

## Features

- React 19 with TypeScript
- urql for GraphQL client
- GraphQL Codegen for type-safe operations
- Feature-based folder structure
- Vite for fast development and builds
- Vitest for testing

## Development

```bash
# Start development server
pnpm dev

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## GraphQL Code Generation

Generate TypeScript types from your GraphQL schema:

```bash
# Ensure the GraphQL API is running on port 4001
pnpm codegen
```

This will generate type-safe hooks and types in `src/graphql/generated.ts`.

## Project Structure

```
src/
  features/           # Feature-based modules
    products/         # Product management
      ProductList.tsx
      ProductForm.tsx
  graphql/            # GraphQL client and queries
    client.ts         # urql client setup
    queries.ts        # GraphQL query/mutation documents
    generated.ts      # Generated types (after running codegen)
  App.tsx             # Main application component
  main.tsx            # Application entry point
```

## API Proxy

The development server proxies `/graphql` requests to `http://localhost:4001` where the GraphQL API should be running.

## Dependencies

- **@octant/types**: Shared TypeScript types
- **urql**: GraphQL client
- **graphql**: GraphQL reference implementation
