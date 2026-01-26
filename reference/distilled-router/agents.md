# distilled-router

`distilled-router` is an **Effect-first routing library** for building type-safe HTTP APIs, inspired by Elysia.

## Design Philosophy

- **Effect-first**: All route handlers return Effects using `Effect.fn`
- **Schema-driven**: Input, output, and errors are defined via Effect Schema
- **Type-safe**: Route metadata is encoded in the type system for client generation
- **Client-friendly**: The `operationId` trait enables future type-safe client generation (`client.<operationId>()`)

## Architecture

### Directory Structure

```
src/
  Route.ts    # Route definition and traits
  Router.ts   # Router composition
  Handler.ts  # WinterCG fetch handler conversion
  Headers.ts  # Request/response headers service
  Gate.ts     # Middleware/guard for route groups
  Client.ts   # Type-safe client generation
test/
  Route.test.ts
  Handler.test.ts
  Gate.test.ts
  Client.test.ts
```

### Core Concepts

#### Route

A Route combines traits (metadata including schemas) with an Effect handler:

```typescript
import { Effect, Schema } from "effect";
import * as Route from "distilled-router/Route";

const getUser = Route.make(
	{
		operationId: "getUser",
		input: Schema.Struct({ id: Schema.String }),
		output: Schema.Struct({ id: Schema.String, name: Schema.String }),
		errors: [NotFoundError],
	},
	Effect.fn(function* ({ id }) {
		const user = yield* UserService.findById(id);
		return user;
	}),
);
```

**Traits:**

| Trait         | Type                           | Default       | Description                                            |
| ------------- | ------------------------------ | ------------- | ------------------------------------------------------ |
| `operationId` | `string` (literal)             | (required)    | Unique identifier for the route (used in clients)      |
| `input`       | `Schema.Schema.AnyNoContext`   | `Schema.Void` | Schema defining the handler's input type               |
| `output`      | `Schema.Schema.AnyNoContext`   | `Schema.Void` | Schema defining the handler's success return type      |
| `errors`      | `Schema.Schema.AnyNoContext[]` | `[]`          | Array of error schemas (converted to union internally) |

**Handler:**

The handler is an `Effect.fn` that:

- Receives the decoded `input` (typed as `Schema.Schema.Type<input>`)
- Returns an `Effect<Output, Errors, R>` where:
  - `Output` matches `Schema.Schema.Type<output>`
  - `Errors` matches the union of `Schema.Schema.Type` for each error schema
  - `R` is any required context/services

**Minimal route (no input, no output, no errors):**

```typescript
const healthCheck = Route.make(
	{ operationId: "healthCheck" },
	Effect.fn(function* () {}),
);
```

#### Router

A Router composes multiple routes:

```typescript
import * as Router from "distilled-router/Router";

const app = Router.make().add(getUser).add(createUser).add(deleteUser);
```

The Router preserves all route types, enabling type-safe client generation (see [Client](#client) below).

**Duplicate operationId detection:**

The Router enforces unique `operationId`s at compile time. Adding a route with a duplicate `operationId` results in a type error:

```typescript
const route1 = Route.make({ operationId: "getUser" }, ...);
const route2 = Route.make({ operationId: "getUser" }, ...);

Router.make()
	.add(route1)
	.add(route2); // Type error: Route with operationId "getUser" already exists
```

#### Handler

Convert a Router to a WinterCG-compliant fetch handler:

```typescript
import * as Handler from "distilled-router/Handler";

const app = Router.make().add(getUser).add(createUser);
const handler = Handler.toFetch(app);

// Use with Cloudflare Workers, Bun, Deno, etc.
export default { fetch: handler };
```

All routes are exposed as `POST /operation/<operationId>`:

- Request body is parsed as JSON and decoded against the input schema
- Success returns 200 with JSON-encoded output
- Schema validation errors return 400
- Handler errors return 400 with the error object
- Unknown operations return 404
- Non-POST methods return 405

#### Headers

The Headers service provides access to request headers and allows setting response headers within route handlers:

```typescript
import * as Headers from "distilled-router/Headers";

const authRoute = Route.make(
	{
		operationId: "checkAuth",
		output: Schema.Struct({ userId: Schema.String }),
	},
	Effect.fn(function* () {
		// Read request headers
		const token = yield* Headers.get("Authorization");
		if (!token) {
			return yield* new UnauthorizedError({});
		}

		// Set response headers
		yield* Headers.set("X-Request-Id", crypto.randomUUID());

		return { userId: "user-123" };
	}),
);
```

**Available methods:**

| Method                    | Description                                                |
| ------------------------- | ---------------------------------------------------------- |
| `Headers.get(name)`       | Get a request header value (returns `string \| undefined`) |
| `Headers.getAll`          | Get all request headers as a `Headers` object              |
| `Headers.set(name, v)`    | Set a response header (overwrites existing)                |
| `Headers.append(name, v)` | Append a response header (useful for Set-Cookie)           |

**Direct service access:**

You can also access the Headers service directly:

```typescript
Effect.fn(function* () {
	const headers = yield* Headers.Headers;
	const auth = headers.get("Authorization");
	headers.set("Cache-Control", "max-age=3600");
});
```

Response headers are included in all responses (success and error).

#### Gate

A Gate provides middleware-like functionality for route groups. It can:

- Run a handler before each route (e.g., auth checks)
- Add shared error types to all routes
- Provide typed context/services to routes

```typescript
import * as Gate from "distilled-router/Gate";

// Define an auth gate
const AuthGate = Gate.make(
	{ errors: [UnauthorizedError] },
	Effect.fn(function* () {
		const token = yield* Headers.get("Authorization");
		if (!token) {
			return yield* new UnauthorizedError({ message: "No token" });
		}
		const user = yield* verifyToken(token);
		return { user }; // This becomes the gate's context
	}),
);

// Add routes to the gate
const protectedRoutes = AuthGate.add(getProfileRoute).add(updateProfileRoute);

// Add to router
const app = Router.make()
	.add(publicRoute) // No auth required
	.add(protectedRoutes); // All routes require auth
```

**Accessing gate context in routes:**

Routes within a gate can access the context returned by the gate handler:

```typescript
const getProfile = Route.make(
	{
		operationId: "getProfile",
		output: Schema.Struct({ name: Schema.String }),
	},
	Effect.fn(function* () {
		const { user } = yield* AuthGate.Context; // Typed!
		return { name: user.name };
	}),
);

const protectedRoutes = AuthGate.add(getProfile);
```

**Gate traits:**

Gates only support the `errors` trait. Errors from the gate are merged with each route's errors:

```typescript
const gate = Gate.make(
	{ errors: [UnauthorizedError] }, // Gate errors
	handler,
);

const route = Route.make({
	operationId: "test",
	errors: [NotFoundError], // Route errors
}, ...);

// Gated route has errors: [UnauthorizedError, NotFoundError]
const gatedRoutes = gate.add(route);
```

**Execution order:**

1. Gate handler runs first
2. If gate handler fails, error is returned
3. Gate context is provided to route handler
4. Route handler runs

#### Client

The Client module generates a type-safe client from a Router type. Each `operationId` becomes a method on the client with fully typed inputs, outputs, and errors.

```typescript
import * as Client from "distilled-router/Client";

const app = Router.make().add(getUser).add(createUser);

// Create a client from the router type
const client = Client.make<typeof app>({
	baseUrl: "https://api.example.com",
	headers: { Authorization: "Bearer token" }, // optional
	fetch: customFetch, // optional custom fetch implementation
});

// Call operations with full type safety
const result = await client.getUser({ id: "123" });

if (result.ok) {
	console.log(result.value.name); // typed as route's output
} else {
	console.error(result.error._tag); // typed as route's error union
}
```

**Client options:**

| Option    | Type                     | Required | Description                           |
| --------- | ------------------------ | -------- | ------------------------------------- |
| `baseUrl` | `string`                 | Yes      | Base URL of the API                   |
| `headers` | `Record<string, string>` | No       | Headers to include with every request |
| `fetch`   | `typeof fetch`           | No       | Custom fetch implementation           |

**Result type:**

All client methods return `Promise<ClientResult<Output, Error>>`:

```typescript
type ClientResult<TOutput, TError> =
	| { readonly ok: true; readonly value: TOutput }
	| { readonly ok: false; readonly error: TError };
```

**Type inference:**

- Input types are inferred from the route's `input` schema
- Output types are inferred from the route's `output` schema
- Error types are inferred from the route's `errors` array
- For gated routes, gate errors are merged with route errors
- Routes with `void` input require no arguments

**Example with gated routes:**

```typescript
const AuthGate = Gate.make(
	{ errors: [UnauthorizedError] },
	Effect.fn(function* () {
		// auth logic...
		return { userId: "user-123" };
	}),
);

const getProfile = Route.make(
	{
		operationId: "getProfile",
		output: Schema.Struct({ name: Schema.String }),
	},
	Effect.fn(function* () {
		const { userId } = yield* AuthGate.Context;
		return { name: `User ${userId}` };
	}),
);

const app = Router.make().add(AuthGate.add(getProfile));
const client = Client.make<typeof app>({ baseUrl: "..." });

// Error type includes both UnauthorizedError (from gate) and any route errors
const result = await client.getProfile();
```

## Error Handling

Errors should be defined using `Schema.TaggedError`:

```typescript
import { Schema } from "effect";

class NotFoundError extends Schema.TaggedError<NotFoundError>()(
	"NotFoundError",
	{
		resource: Schema.String,
		id: Schema.String,
	},
) {}

class ValidationError extends Schema.TaggedError<ValidationError>()(
	"ValidationError",
	{
		message: Schema.String,
	},
) {}
```

Pass errors as an array to `Route.make`:

```typescript
Route.make(
	{
		operationId: "updateUser",
		input: Schema.Struct({ id: Schema.String, name: Schema.String }),
		output: Schema.Struct({ id: Schema.String, name: Schema.String }),
		errors: [NotFoundError, ValidationError],
	},
	Effect.fn(function* ({ id, name }) {
		// ...
	}),
);
```

## Code Style

### Effect Patterns

Handlers use `Effect.fn` for generator-based effects:

```typescript
Route.make(
	{
		operationId: "createPost",
		input: Schema.Struct({ title: Schema.String, body: Schema.String }),
		output: Schema.Struct({ id: Schema.String }),
		errors: [ValidationError],
	},
	Effect.fn(function* ({ title, body }) {
		const id = yield* IdService.generate();
		yield* PostRepository.save({ id, title, body });
		return { id };
	}),
);
```

## Cloudflare Workers

For Cloudflare Workers, use `toCloudflareHandler` with a typed environment:

```typescript
import * as Handler from "distilled-router/Handler";

interface Env {
	MY_SECRET: string;
	MY_KV: KVNamespace;
}

const WorkerEnv = Handler.makeWorkerEnv<Env>();

const myRoute = Route.make(
	{ operationId: "myRoute" },
	Effect.fn(function* () {
		const env = yield* WorkerEnv; // Typed as Env
		const ctx = yield* Handler.WorkerCtx; // ExecutionContext
		return { secret: env.MY_SECRET };
	}),
);

const app = Router.make().add(myRoute);

export default {
	fetch: Handler.toCloudflareHandler(app, WorkerEnv),
} satisfies ExportedHandler<Env>;
```

## Guidelines

- Every route MUST have a unique `operationId`
- Keep route definitions close to their domain logic
- Use descriptive operationIds that match the action (e.g., `getUser`, `createPost`, `deleteComment`)
- Define error types using `Schema.TaggedError` for consistent error handling
- Use Gates for cross-cutting concerns like authentication, rate limiting, or logging
- Gates should return meaningful context that routes can use (e.g., authenticated user info)
- Gate context is fully type-safe: the return type of the gate handler flows to `Gate.Context`

## Related Context

- `@effect/platform` - Platform-specific HTTP handling (future integration)
- `effect/Schema` - Schema definitions for input/output/error validation
