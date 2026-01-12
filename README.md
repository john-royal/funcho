# Funcho

Funcho is a contract-first HTTP router for [Effect](https://effect.website). Define your API contracts declaratively with full type safety, automatic schema validation, and OpenAPI generation.

## Features

- **Contract-first design** - Define routes, parameters, and responses as schemas before implementing handlers
- **Full type safety** - Request context and responses are fully typed, including status codes and headers
- **Typed response helpers** - `ctx.respond()` and `ctx.fail()` are typed based on your contract
- **Automatic validation** - Path, query, header, and body parameters are validated against schemas
- **OpenAPI generation** - Generate OpenAPI 3.0 specs directly from contracts
- **Effect-native** - Built on Effect for composable, type-safe error handling
- **Runtime agnostic** - Works with Cloudflare Workers, Bun, Node.js, or any Fetch API-compatible runtime

## Installation

```bash
npm install funcho effect
```

## Quick Start

```typescript
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { defineContract, FetchHandler, response } from "funcho";

// 1. Define your contract with typed responses
const Contract = defineContract({
  "/users": {
    get: {
      query: { limit: Schema.optional(Schema.NumberFromString) },
      success: response(Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String }))),
    },
    post: {
      body: Schema.Struct({ name: Schema.String }),
      success: response(
        Schema.Struct({ id: Schema.Number, name: Schema.String }),
        { status: 201 },
      ),
    },
  },
  "/users/{id}": {
    get: {
      path: { id: Schema.NumberFromString },
      success: response(Schema.Struct({ id: Schema.Number, name: Schema.String })),
      failure: response(Schema.Struct({ message: Schema.String }), { status: 404 }),
    },
  },
});

// 2. Implement the contract with typed ctx.respond() and ctx.fail()
const ContractImpl = Layer.sync(Contract, () => ({
  "/users": {
    get: (ctx) => Effect.succeed(ctx.respond([{ id: 1, name: "Alice" }])),
    post: (ctx) => Effect.succeed(ctx.respond({ id: 2, name: ctx.body.name })),
  },
  "/users/{id}": {
    get: (ctx) => Effect.gen(function* () {
      const user = users.find((u) => u.id === ctx.path.id);
      if (!user) {
        return yield* Effect.fail({ message: "User not found" });
      }
      return ctx.respond(user);
    }),
  },
}));

// 3. Create a fetch handler
const handler = Effect.runSync(
  FetchHandler.from(Contract).pipe(Effect.provide(ContractImpl))
);

// 4. Use with your runtime (Bun example)
Bun.serve({ fetch: handler });
```

## Response Definition

Use the `response()` helper to define response types with status codes and headers:

```typescript
import { response } from "funcho";

// Simple response (defaults to status 200)
response(Schema.String)

// With custom status code
response(User, { status: 201 })

// With typed headers
response(Schema.Array(User), {
  headers: { "X-Total-Count": Schema.Number },
})

// With both status and headers
response(User, {
  status: 201,
  headers: { "X-Request-Id": Schema.String },
})
```

### Union Responses

When a route can return different status codes, use `response.union()`:

```typescript
const Contract = defineContract({
  "/items": {
    post: {
      body: Schema.Struct({ name: Schema.String }),
      // Can return 201 (created) or 200 (already exists)
      success: response.union(
        response(Item, { status: 201 }),
        response(Item, { status: 200 }),
      ),
    },
  },
});

// In handler, status is required when multiple options exist
post: (ctx) => Effect.gen(function* () {
  if (exists) {
    return ctx.respond(item, { status: 200 });
  }
  return ctx.respond(newItem, { status: 201 });
})
```

## Handler Context

Each route handler receives a typed context with:

| Property | Description |
|----------|-------------|
| `ctx.path` | Decoded path parameters |
| `ctx.query` | Decoded query parameters |
| `ctx.headers` | Decoded request headers |
| `ctx.body` | Decoded request body |
| `ctx.respond(data, options?)` | Create a typed success response |

### `ctx.respond()`

Creates a success response. Status and headers are type-checked based on the contract:

```typescript
// Simple response (status inferred from contract)
ctx.respond({ id: 1, name: "Alice" })

// With typed headers (required if defined in contract)
ctx.respond(users, { headers: { "X-Total-Count": users.length } })

// With explicit status (required for union responses)
ctx.respond(user, { status: 201, headers: { "X-Request-Id": requestId } })
```

### Error Handling in Handlers

Errors that match the contract's `failure` type are **automatically wrapped** with the correct status code. Just use `Effect.fail()`:

```typescript
// Error is automatically wrapped with 404 status from contract
get: (ctx) => Effect.gen(function* () {
  const user = users.find(u => u.id === ctx.path.id);
  if (!user) {
    return yield* Effect.fail(
      new UserNotFoundError({ message: "User not found" })
    );
  }
  return ctx.respond(user);
})

// Union failures - each error type gets its defined status
put: (ctx) => Effect.gen(function* () {
  if (notFound) {
    return yield* Effect.fail(new NotFoundError({ ... })); // 404
  }
  if (conflict) {
    return yield* Effect.fail(new ConflictError({ ... })); // 409
  }
  return ctx.respond(updated);
})
```

**Key points:**
- Errors matching the contract `failure` type are auto-wrapped with their status code
- Each error type must map to exactly one status code in the contract
- Errors not in the contract go through `formatError`

## Contract Definition

Contracts define the shape of your API:

| Field | Description |
|-------|-------------|
| `path` | Path parameter schemas (e.g., `{ id: Schema.NumberFromString }`) |
| `query` | Query parameter schemas |
| `headers` | Request header schemas |
| `body` | Request body schema |
| `success` | Success response definition using `response()` |
| `failure` | Failure response definition using `response()` or `response.union()` |
| `description` | Route description (used in OpenAPI) |

```typescript
const Contract = defineContract({
  "/items/{id}": {
    put: {
      description: "Update an item",
      path: { id: Schema.NumberFromString },
      headers: { "x-request-id": Schema.String },
      query: { notify: Schema.optional(Schema.BooleanFromString) },
      body: Schema.Struct({ name: Schema.String, price: Schema.Number }),
      success: response(Item, {
        headers: { "x-updated-at": Schema.String },
      }),
      failure: response.union(
        response(NotFoundError, { status: 404 }),
        response(ValidationError, { status: 400 }),
      ),
    },
  },
});
```

### Strict Type Checking

Contracts enforce strict property checking. Adding unknown properties causes a type error:

```typescript
const Contract = defineContract({
  "/users": {
    get: {
      success: response(Schema.Array(Schema.String)),
      unknownProperty: "value", // Type error!
    },
  },
});
```

## Error Handling

### Domain Errors

Define domain-specific errors using `Schema.ErrorClass`:

```typescript
import * as Schema from "effect/Schema";

class UserNotFoundError extends Schema.ErrorClass<UserNotFoundError>(
  "UserNotFoundError"
)({ message: Schema.String, userId: Schema.optional(Schema.Number) }) {}

class EmailExistsError extends Schema.ErrorClass<EmailExistsError>(
  "EmailExistsError"
)({ message: Schema.String }) {}
```

Use errors in contracts and handlers:

```typescript
const Contract = defineContract({
  "/users/{id}": {
    get: {
      path: { id: Schema.NumberFromString },
      success: response(User),
      failure: response(UserNotFoundError, { status: 404 }),
    },
  },
});

// In handler - error is auto-wrapped with 404 status from contract
get: (ctx) => Effect.gen(function* () {
  const user = users.find((u) => u.id === ctx.path.id);
  if (!user) {
    return yield* Effect.fail(new UserNotFoundError({
      message: `User ${ctx.path.id} not found`,
      userId: ctx.path.id,
    }));
  }
  return ctx.respond(user);
}),
```

### Custom Error Formatting

Customize error responses for errors that don't match the contract's `failure` types:

```typescript
import { FetchHandler, ValidationError, type ErrorResponse } from "funcho";

const formatError = (error: unknown, request: Request): ErrorResponse => {
  if (error instanceof ValidationError) {
    return {
      status: 400,
      body: { type: "validation_error", message: error.message, issues: error.issues },
    };
  }
  return {
    status: 500,
    body: { type: "internal_error", message: "An unexpected error occurred" },
  };
};

const handler = Effect.runSync(
  FetchHandler.from(Contract, { formatError }).pipe(Effect.provide(ContractImpl))
);
```

### Built-in Errors

Funcho provides built-in error classes for routing errors:

| Error | Status | Description |
|-------|--------|-------------|
| `ValidationError` | 400 | Schema validation failed |
| `NotFoundError` | 404 | Route not found |
| `MethodNotAllowedError` | 405 | HTTP method not allowed for route |
| `InternalServerError` | 500 | Unexpected server error |

## Streaming Responses

Handle streaming responses with `StreamBody`:

```typescript
import { StreamBody } from "funcho";

const Contract = defineContract({
  "/download": {
    get: {
      success: response(StreamBody),
    },
  },
});

// In handler
get: (ctx) => Effect.succeed(ctx.respond(new ReadableStream({ /* ... */ }))),
```

## OpenAPI Generation

Generate OpenAPI 3.0 specs from contracts:

```typescript
import { OpenAPI } from "funcho";

const spec = OpenAPI.from(Contract.Contract, {
  title: "My API",
  version: "1.0.0",
  description: "API description",
});

// Serve as JSON
if (url.pathname === "/openapi.json") {
  return new Response(JSON.stringify(spec, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
```

The generated spec includes:
- Path and query parameters with JSON Schema types
- Request body schemas
- Success and error responses with their status codes
- Response headers
- Route descriptions

## Runtime Examples

### Bun

```typescript
Bun.serve({
  fetch: handler,
  port: 3000,
});
```

### Cloudflare Workers

```typescript
export default {
  fetch: handler,
};
```

### Node.js

```typescript
import { createServer } from "node:http";

createServer(async (req, res) => {
  const request = new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers: req.headers as HeadersInit,
  });
  const response = await handler(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(await response.text());
}).listen(3000);
```

## Full Example

See [`examples/users-api.ts`](./examples/users-api.ts) for a complete CRUD API example demonstrating:
- Contract definition with multiple routes
- Path, query, and body parameter validation
- Typed response headers
- Union responses for different status codes
- Auto-wrapped domain errors with `Effect.fail()`
- Custom error formatting
- OpenAPI spec generation

## API Reference

### `defineContract(contract)`

Creates a typed contract service from a contract definition.

### `response(schema, options?)`

Creates a response definition with optional status and headers.

Options:
- `status?: number` - HTTP status code (default: 200)
- `headers?: Record<string, Schema.Top>` - Response header schemas

### `response.union(...responses)`

Creates a union of response definitions for routes that can return multiple status codes.

### `FetchHandler.from(contract, options?)`

Creates a Fetch API handler from a contract. Returns `Effect.Effect<(request: Request) => Promise<Response>, never, ContractService<C>>`.

Options:
- `formatError?: (error: unknown, request: Request) => ErrorResponse` - Custom error formatter

### `OpenAPI.from(contract, info)`

Generates an OpenAPI 3.0 spec from a contract.

### Type Exports

- `Contract` - Contract type
- `RouteDefinition` - Route definition type
- `Implementation<C>` - Implementation type for contract `C`
- `ContractService<C>` - Service type for contract `C`
- `ResponseSchema` - Response schema type
- `ResponseUnion` - Response union type
- `TypedResponse` - Typed response wrapper
- `ErrorResponse` - Error response shape for `formatError`

## Releases

This project uses automated releases via [semantic-release](https://github.com/semantic-release/semantic-release).

### For Contributors

**Commit Message Format:**

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: add new feature` → Minor version bump (0.1.0 → 0.2.0)
- `fix: resolve bug` → Patch version bump (0.1.0 → 0.1.1)
- `feat!: breaking change` → Major version bump (0.1.0 → 1.0.0)
- `docs:`, `chore:`, `test:` → No release

**Preview next version:**

```bash
bun run release:preview
```

### For Maintainers

**To create a release:**

1. Go to [Actions → Release](https://github.com/john-royal/funcho/actions/workflows/release.yml)
2. Click "Run workflow"
3. Options:
   - Leave empty for auto-detect version from commits
   - Enter custom version (e.g., `1.0.0`) for manual control
   - Check "Dry run" to preview without publishing

The workflow will:
- ✅ Determine version from commits (or use custom version)
- ✅ Update `package.json` and `CHANGELOG.md`
- ✅ Create git tag (e.g., `v1.0.0`)
- ✅ Publish to npm with provenance
- ✅ Create GitHub Release with auto-generated notes

## License

MIT
