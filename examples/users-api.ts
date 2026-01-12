import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  defineContract,
  type ErrorResponse,
  FetchHandler,
  OpenAPI,
  response,
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
)({ message: Schema.String, userId: Schema.optional(Schema.Number) }) {}

class EmailAlreadyExistsError extends Schema.ErrorClass<EmailAlreadyExistsError>(
  "EmailAlreadyExistsError",
)({ message: Schema.String }) {}

const Contract = defineContract({
  "/users": {
    get: {
      description: "List all users",
      query: {
        limit: Schema.optional(Schema.NumberFromString),
        offset: Schema.optional(Schema.NumberFromString),
      },
      success: response(
        Schema.Struct({
          users: Schema.Array(User),
          total: Schema.Number,
        }),
        {
          headers: {
            "X-Total-Count": Schema.Number,
            "X-Page-Size": Schema.Number,
          },
        },
      ),
    },
    post: {
      description: "Create a new user",
      body: Schema.Struct({
        name: Schema.String,
        email: Schema.String,
      }),
      success: response(User, {
        status: 201,
        headers: { "X-Request-Id": Schema.String },
      }),
      failure: response(EmailAlreadyExistsError, { status: 409 }),
    },
  },
  "/users/{id}": {
    get: {
      description: "Get a user by ID",
      path: { id: Schema.NumberFromString },
      success: response(User),
      failure: response(UserNotFoundError, { status: 404 }),
    },
    put: {
      description: "Update a user",
      path: { id: Schema.NumberFromString },
      body: Schema.Struct({
        name: Schema.optional(Schema.String),
        email: Schema.optional(Schema.String),
      }),
      success: response(User),
      failure: response.union(
        response(UserNotFoundError, { status: 404 }),
        response(EmailAlreadyExistsError, { status: 409 }),
      ),
    },
    delete: {
      description: "Delete a user",
      path: { id: Schema.NumberFromString },
      success: response(Schema.Void, { status: 204 }),
      failure: response(UserNotFoundError, { status: 404 }),
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
        ctx.respond(
          { users: slice, total: users.length },
          {
            headers: {
              "X-Total-Count": users.length,
              "X-Page-Size": limit,
            },
          },
        ),
      );
    },
    post: (ctx) =>
      Effect.gen(function* () {
        const exists = users.some((u) => u.email === ctx.body.email);
        if (exists) {
          return yield* Effect.fail(
            new EmailAlreadyExistsError({ message: "Email already in use" }),
          );
        }
        const user: User = {
          id: nextId++,
          name: ctx.body.name,
          email: ctx.body.email,
        };
        users.push(user);
        return ctx.respond(user, {
          headers: { "X-Request-Id": crypto.randomUUID() },
        });
      }),
  },
  "/users/{id}": {
    get: (ctx) =>
      Effect.gen(function* () {
        const user = users.find((u) => u.id === ctx.path.id);
        if (!user) {
          return yield* Effect.fail(
            new UserNotFoundError({
              message: `User ${ctx.path.id} not found`,
              userId: ctx.path.id,
            }),
          );
        }
        return ctx.respond(user);
      }),
    put: (ctx) =>
      Effect.gen(function* () {
        const index = users.findIndex((u) => u.id === ctx.path.id);
        if (index === -1) {
          return yield* Effect.fail(
            new UserNotFoundError({
              message: `User ${ctx.path.id} not found`,
              userId: ctx.path.id,
            }),
          );
        }
        if (ctx.body.email) {
          const emailExists = users.some(
            (u) => u.email === ctx.body.email && u.id !== ctx.path.id,
          );
          if (emailExists) {
            return yield* Effect.fail(
              new EmailAlreadyExistsError({ message: "Email already in use" }),
            );
          }
        }
        const user = users[index]!;
        const updated: User = {
          id: user.id,
          name: ctx.body.name ?? user.name,
          email: ctx.body.email ?? user.email,
        };
        users[index] = updated;
        return ctx.respond(updated);
      }),
    delete: (ctx) =>
      Effect.gen(function* () {
        const index = users.findIndex((u) => u.id === ctx.path.id);
        if (index === -1) {
          return yield* Effect.fail(
            new UserNotFoundError({
              message: `User ${ctx.path.id} not found`,
              userId: ctx.path.id,
            }),
          );
        }
        users.splice(index, 1);
        return ctx.respond(undefined);
      }),
  },
}));

const formatError = (error: unknown, request: Request): ErrorResponse => {
  const url = new URL(request.url);

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
