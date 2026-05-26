# @octant/graphql

GraphQL API server built with GraphQL Yoga and Pothos.

## Overview

This application provides a GraphQL API with:

- **GraphQL Yoga** - Fast, batteries-included GraphQL server
- **Pothos** - Code-first GraphQL schema builder with full TypeScript support
- **Type Safety** - Schema types derived from `@octant/types` interfaces

## Getting Started

```bash
# Install dependencies (from monorepo root)
pnpm install

# Start development server
pnpm --filter @octant/graphql dev

# Build for production
pnpm --filter @octant/graphql build

# Run production server
pnpm --filter @octant/graphql start
```

The server runs on `http://localhost:4001/graphql` by default.

## Configuration

Environment variables:

- `GRAPHQL_PORT` - Server port (default: 4001)

## Schema Structure

```
src/
  builder.ts              # Pothos SchemaBuilder configuration
  schema/
    index.ts              # Schema assembly and export
    types/
      product.ts          # Product object type
      user.ts             # User object type
    queries/
      product.ts          # Product queries
      user.ts             # User queries
    mutations/
      product.ts          # Product mutations
```

## Available Operations

### Queries

```graphql
# Fetch all products
query {
  products {
    id
    name
    description
    price
    createdAt
    updatedAt
  }
}

# Fetch single product
query {
  product(id: "...") {
    id
    name
    price
  }
}

# Fetch all users
query {
  users {
    id
    email
    name
  }
}

# Fetch single user
query {
  user(id: "...") {
    id
    email
    name
  }
}
```

### Mutations

```graphql
# Create product
mutation {
  createProduct(input: {
    name: "New Product"
    description: "Product description"
    price: 2999
  }) {
    id
    name
  }
}

# Update product
mutation {
  updateProduct(id: "...", input: {
    name: "Updated Name"
    price: 3999
  }) {
    id
    name
    price
    updatedAt
  }
}

# Delete product
mutation {
  deleteProduct(id: "...")
}
```

## Development

### Adding New Types

1. Define the interface in `@octant/types`
2. Add the type to `PothosTypes` in `builder.ts`
3. Create the object type in `src/schema/types/`
4. Import the type file in `src/schema/index.ts`

### Adding New Queries/Mutations

1. Create the query/mutation file in the appropriate directory
2. Use `builder.queryField()` or `builder.mutationField()`
3. Import the file in `src/schema/index.ts`

## Testing

```bash
# Run tests
pnpm --filter @octant/graphql test

# Run with watch mode
pnpm --filter @octant/graphql test -- --watch
```

## GraphiQL

When running in development mode, GraphiQL is available at `http://localhost:4001/graphql` for exploring the API.
