import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  defineContract,
  type ErrorResponse,
  FetchHandler,
  httpStatus,
  OpenAPI,
  Respond,
  ValidationError,
} from "../src/index.js";

const User = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  email: Schema.String,
});
type User = typeof User.Type;

class UserNotFoundError extends Schema.ErrorClass<UserNotFoundError>(
  "UserNotFoundError",
)({ message: Schema.String }, { httpStatus: 404 }) {}

class EmailAlreadyExistsError extends Schema.ErrorClass<EmailAlreadyExistsError>(
  "EmailAlreadyExistsError",
)({ message: Schema.String }, { httpStatus: 409 }) {}

const Contract = defineContract({
  "/users": {
    get: {
      description: "List all users",
      query: {
        limit: Schema.optional(Schema.NumberFromString),
        offset: Schema.optional(Schema.NumberFromString),
      },
      success: Schema.Struct({
        users: Schema.Array(User),
        total: Schema.Number,
      }),
      responseHeaders: {
        "X-Total-Count": Schema.NumberFromString,
        "X-Page-Size": Schema.NumberFromString,
      },
    },
    post: {
      description: "Create a new user",
      body: Schema.Struct({
        name: Schema.String,
        email: Schema.String,
      }),
      success: httpStatus(User, 201),
      failure: EmailAlreadyExistsError,
      responseHeaders: {
        "X-Request-Id": Schema.String,
      },
    },
  },
  "/users/{id}": {
    get: {
      description: "Get a user by ID",
      path: { id: Schema.NumberFromString },
      success: User,
      failure: UserNotFoundError,
    },
    put: {
      description: "Update a user",
      path: { id: Schema.NumberFromString },
      body: Schema.Struct({
        name: Schema.optional(Schema.String),
        email: Schema.optional(Schema.String),
      }),
      success: User,
      failure: Schema.Union([UserNotFoundError, EmailAlreadyExistsError]),
    },
    delete: {
      description: "Delete a user",
      path: { id: Schema.NumberFromString },
      success: httpStatus(Schema.Void, 204),
      failure: UserNotFoundError,
    },
  },
});

const users: User[] = [
  { id: 1, name: "Alice", email: "alice@example.com" },
  { id: 2, name: "Bob", email: "bob@example.com" },
];
let nextId = 3;

const ContractImpl = Layer.sync(Contract, () => ({
  "/users": {
    get: (ctx) => {
      const offset = ctx.query.offset ?? 0;
      const limit = ctx.query.limit ?? 10;
      const slice = users.slice(offset, offset + limit);
      return Effect.succeed(
        Respond.ok(
          { users: slice, total: users.length },
          {
            headers: {
              "X-Total-Count": String(users.length),
              "X-Page-Size": String(limit),
            },
          },
        ),
      );
    },
    post: (ctx) =>
      Effect.gen(function* () {
        const exists = users.some((u) => u.email === ctx.body.email);
        if (exists) {
          return yield* new EmailAlreadyExistsError({
            message: "Email already in use",
          });
        }
        const user: User = {
          id: nextId++,
          name: ctx.body.name,
          email: ctx.body.email,
        };
        users.push(user);
        return Respond.created(user, {
          headers: { "X-Request-Id": crypto.randomUUID() },
          statusText: "User Created",
        });
      }),
  },
  "/users/{id}": {
    get: (ctx) =>
      Effect.gen(function* () {
        const user = users.find((u) => u.id === ctx.path.id);
        if (!user) {
          return yield* new UserNotFoundError({
            message: `User ${ctx.path.id} not found`,
          });
        }
        return user;
      }),
    put: (ctx) =>
      Effect.gen(function* () {
        const index = users.findIndex((u) => u.id === ctx.path.id);
        if (index === -1) {
          return yield* new UserNotFoundError({
            message: `User ${ctx.path.id} not found`,
          });
        }
        if (ctx.body.email) {
          const emailExists = users.some(
            (u) => u.email === ctx.body.email && u.id !== ctx.path.id,
          );
          if (emailExists) {
            return yield* new EmailAlreadyExistsError({
              message: "Email already in use",
            });
          }
        }
        const user = users[index]!;
        const updated: User = {
          id: user.id,
          name: ctx.body.name ?? user.name,
          email: ctx.body.email ?? user.email,
        };
        users[index] = updated;
        return updated;
      }),
    delete: (ctx) =>
      Effect.gen(function* () {
        const index = users.findIndex((u) => u.id === ctx.path.id);
        if (index === -1) {
          return yield* new UserNotFoundError({
            message: `User ${ctx.path.id} not found`,
          });
        }
        users.splice(index, 1);
        return Respond.noContent({
          headers: { "X-Deleted-Id": String(ctx.path.id) },
        });
      }),
  },
}));

const formatError = (error: unknown, request: Request): ErrorResponse => {
  const url = new URL(request.url);

  // Validation errors (bad JSON, missing fields, type mismatches)
  if (error instanceof ValidationError) {
    return {
      status: 400,
      body: {
        type: "validation_error",
        message: error.message,
        path: url.pathname,
        details: error.issues,
      },
    };
  }

  // Domain errors (UserNotFoundError, EmailAlreadyExistsError)
  if (error instanceof UserNotFoundError) {
    return {
      status: 404,
      body: {
        type: "not_found",
        message: error.message,
        path: url.pathname,
      },
    };
  }

  if (error instanceof EmailAlreadyExistsError) {
    return {
      status: 409,
      body: {
        type: "conflict",
        message: error.message,
        path: url.pathname,
      },
    };
  }

  // Unexpected errors
  console.error("Unexpected error:", error);
  return {
    status: 500,
    body: {
      type: "internal_error",
      message: "An unexpected error occurred",
      path: url.pathname,
    },
  };
};

const handler = Effect.runSync(
  FetchHandler.from(Contract, { formatError }).pipe(
    Effect.provide(ContractImpl),
  ),
);

Bun.serve({
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/openapi.json") {
      const spec = OpenAPI.from(Contract.Contract, {
        title: "Users API",
        version: "1.0.0",
        description: "A simple users API built with Funcho",
      });
      return new Response(JSON.stringify(spec, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return handler(request);
  },
});
