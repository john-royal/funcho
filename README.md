# Funcho

Funcho is a contract-first HTTP router for [Effect](https://effect.website). Define your API contracts declaratively with full type safety, automatic schema validation, and OpenAPI generation.

## Features

- **Contract-first design** - Define routes, parameters, and responses as schemas before implementing handlers
- **Full type safety** - Request context (path, query, headers, body) and responses are fully typed based on contracts
- **Automatic validation** - Path, query, header, and body parameters are validated against schemas
- **OpenAPI generation** - Generate OpenAPI 3.0 specs directly from contracts
- **Effect-native** - Built on Effect for composable, type-safe error handling
- **Runtime agnostic** - Works with Cloudflare Workers, Bun, Node.js, or any Fetch API-compatible runtime
- **Custom response control** - Full control over status codes, headers, and response bodies

## Installation

```bash
npm install funcho effect
```

## Quick Start

```typescript
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { defineContract, FetchHandler } from "funcho";

// 1. Define your contract
const Contract = defineContract({
  "/users": {
    get: {
      query: { limit: Schema.optional(Schema.NumberFromString) },
      success: Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String })),
    },
    post: {
      body: Schema.Struct({ name: Schema.String }),
      success: Schema.Struct({ id: Schema.Number, name: Schema.String }),
    },
  },
  "/users/{id}": {
    get: {
      path: { id: Schema.NumberFromString },
      success: Schema.Struct({ id: Schema.Number, name: Schema.String }),
    },
  },
});

// 2. Implement the contract
const ContractImpl = Layer.sync(Contract, () => ({
  "/users": {
    get: (ctx) => Effect.succeed([{ id: 1, name: "Alice" }].slice(0, ctx.query.limit ?? 10)),
    post: (ctx) => Effect.succeed({ id: 2, name: ctx.body.name }),
  },
  "/users/{id}": {
    get: (ctx) => Effect.succeed({ id: ctx.path.id, name: "Alice" }),
  },
}));

// 3. Create a fetch handler
const handler = Effect.runSync(
  FetchHandler.from(Contract).pipe(Effect.provide(ContractImpl))
);

// 4. Use with your runtime (Bun example)
Bun.serve({ fetch: handler });
```

## Contract Definition

Contracts define the shape of your API using Effect schemas. Each route can specify:

| Field | Description |
|-------|-------------|
| `path` | Path parameter schemas (e.g., `{ id: Schema.NumberFromString }`) |
| `query` | Query parameter schemas |
| `headers` | Request header schemas |
| `body` | Request body schema |
| `success` | Success response schema |
| `failure` | Error response schema |
| `description` | Route description (used in OpenAPI) |
| `responseHeaders` | Response header schemas (used in OpenAPI) |

```typescript
const Contract = defineContract({
  "/items/{id}": {
    put: {
      description: "Update an item",
      path: { id: Schema.NumberFromString },
      headers: { "x-request-id": Schema.String },
      query: { notify: Schema.optional(Schema.BooleanFromString) },
      body: Schema.Struct({ name: Schema.String, price: Schema.Number }),
      success: Schema.Struct({ id: Schema.Number, name: Schema.String }),
      failure: ItemNotFoundError,
      responseHeaders: { "x-updated-at": Schema.String },
    },
  },
});
```

### Strict Type Checking

Contracts enforce strict property checking. Adding unknown properties to a route definition causes a type error:

```typescript
const Contract = defineContract({
  "/users": {
    get: {
      success: Schema.Array(Schema.String),
      unknownProperty: "value", // Type error: 'unknownProperty' does not exist
    },
  },
});
```

## Response Helpers

Use `Respond` helpers to control status codes, headers, and status text:

```typescript
import { Respond } from "funcho";

// 200 OK with custom headers
Respond.ok(data, { headers: { "X-Custom": "value" } });

// 201 Created
Respond.created(newResource, { statusText: "Resource Created" });

// 202 Accepted
Respond.accepted({ jobId: "abc123" });

// 204 No Content
Respond.noContent();

// Custom status code
Respond.custom(data, 301, { headers: { Location: "/new-path" } });
```

### Custom Response Classes

Implement `ResponseBody` for full control over response serialization:

```typescript
import { ResponseBody, ResponseBodySymbol } from "funcho";

class FileDownload implements ResponseBody {
  readonly [ResponseBodySymbol] = true as const;

  constructor(readonly content: string, readonly filename: string) {}

  toResponse() {
    return {
      body: this.content,
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${this.filename}"`,
      },
    };
  }
}

// Use in handler
"/export": {
  get: () => Effect.succeed(new FileDownload("id,name\n1,Alice", "users.csv")),
}
```

## Error Handling

### Domain Errors

Define domain-specific errors using `Schema.ErrorClass` with HTTP status annotations:

```typescript
import * as Schema from "effect/Schema";

class UserNotFoundError extends Schema.ErrorClass<UserNotFoundError>(
  "UserNotFoundError"
)({ message: Schema.String }, { httpStatus: 404 }) {}

class EmailAlreadyExistsError extends Schema.ErrorClass<EmailAlreadyExistsError>(
  "EmailAlreadyExistsError"
)({ message: Schema.String, email: Schema.String }, { httpStatus: 409 }) {}
```

Use errors in contracts and handlers:

```typescript
const Contract = defineContract({
  "/users/{id}": {
    get: {
      path: { id: Schema.NumberFromString },
      success: User,
      failure: UserNotFoundError,
    },
  },
});

// In handler
get: (ctx) => Effect.gen(function* () {
  const user = users.find((u) => u.id === ctx.path.id);
  if (!user) {
    return yield* new UserNotFoundError({ message: `User ${ctx.path.id} not found` });
  }
  return user;
}),
```

### Custom Error Formatting

Customize error responses with `formatError`:

```typescript
import { FetchHandler, ValidationError, type ErrorResponse } from "funcho";

const formatError = (error: unknown, request: Request): ErrorResponse => {
  if (error instanceof ValidationError) {
    return {
      status: 400,
      body: { type: "validation_error", message: error.message, issues: error.issues },
    };
  }
  if (error instanceof UserNotFoundError) {
    return {
      status: 404,
      body: { type: "not_found", message: error.message },
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

### Errors with Custom Response Bodies

Errors can implement `ResponseBody` for full control over their HTTP response. This takes precedence over `formatError`:

```typescript
class CustomApiError
  extends Schema.ErrorClass<CustomApiError>("CustomApiError")(
    { message: Schema.String, code: Schema.String },
    { httpStatus: 422 }
  )
  implements ResponseBody
{
  readonly [ResponseBodySymbol] = true as const;

  toResponse() {
    return {
      body: JSON.stringify({ error: this.code, message: this.message }),
      status: 422,
      headers: { "X-Error-Code": this.code },
    };
  }
}
```

### Built-in Errors

Funcho provides built-in error classes:

| Error | Status | Description |
|-------|--------|-------------|
| `ValidationError` | 400 | Schema validation failed |
| `NotFoundError` | 404 | Route not found |
| `MethodNotAllowedError` | 405 | HTTP method not allowed for route |
| `InternalServerError` | 500 | Unexpected server error |

## Schema Annotations

### HTTP Status

Set the default status code for success responses:

```typescript
import { httpStatus } from "funcho";

const Contract = defineContract({
  "/users": {
    post: {
      body: Schema.Struct({ name: Schema.String }),
      success: httpStatus(User, 201), // Returns 201 Created
    },
    delete: {
      success: httpStatus(Schema.Void, 204), // Returns 204 No Content
    },
  },
});
```

### Content Type

Set custom content types:

```typescript
import { contentType } from "funcho";

const Contract = defineContract({
  "/report": {
    get: {
      success: contentType(Schema.String, "text/csv"),
    },
  },
});
```

### Stream Body

Handle streaming responses:

```typescript
import { StreamBody } from "funcho";

const Contract = defineContract({
  "/download": {
    get: {
      success: StreamBody, // ReadableStream with application/octet-stream
    },
  },
});

// In handler
get: () => Effect.succeed(new ReadableStream({ /* ... */ })),
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
- Success and error response schemas
- Response headers (from `responseHeaders` field)
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
- Custom response helpers with headers
- Domain error handling with `ResponseBody`
- Custom error formatting
- OpenAPI spec generation

## API Reference

### `defineContract(contract)`

Creates a typed contract service from a contract definition.

### `FetchHandler.from(contract, options?)`

Creates a Fetch API handler from a contract. Returns `Effect.Effect<(request: Request) => Promise<Response>, never, ContractService<C>>`.

Options:
- `formatError?: (error: unknown, request: Request) => ErrorResponse` - Custom error formatter

### `OpenAPI.from(contract, info)`

Generates an OpenAPI 3.0 spec from a contract.

### `Respond`

Response helpers:
- `Respond.ok(data, options?)` - 200 OK
- `Respond.created(data, options?)` - 201 Created
- `Respond.accepted(data, options?)` - 202 Accepted
- `Respond.noContent(options?)` - 204 No Content
- `Respond.custom(data, status, options?)` - Custom status

### Schema Helpers

- `httpStatus(schema, status)` - Annotate schema with HTTP status
- `contentType(schema, type)` - Annotate schema with content type
- `StreamBody` - Schema for `ReadableStream` responses

### Type Exports

- `Contract` - Contract type
- `RouteDefinition` - Route definition type
- `Implementation<C>` - Implementation type for contract `C`
- `ContractService<C>` - Service type for contract `C`
- `ResponseBody` - Interface for custom response serialization
- `ErrorResponse` - Error response shape for `formatError`

## License

MIT
