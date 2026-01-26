import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Handler from "../src/Handler.js";
import * as Route from "../src/Route.js";
import * as Router from "../src/Router.js";

// Test schemas
const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
});

// Test errors
class NotFoundError extends Route.Error(
  "NotFoundError",
  404,
)({
  message: Schema.String,
}) {}

class ValidationError extends Route.Error(
  "ValidationError",
  400,
)({
  message: Schema.String,
  fields: Schema.Array(Schema.String),
}) {}

// Mock user data
const users = new Map([
  ["1", { id: "1", name: "John Doe", email: "john@example.com" }],
  ["2", { id: "2", name: "Jane Doe", email: "jane@example.com" }],
]);

// Test routes
const getUser = Route.get(
  "/users/:id",
  {
    path: Schema.Struct({ id: Schema.String }),
    success: User.pipe(Route.status(200)),
    errors: [NotFoundError],
  },
  Effect.fnUntraced(function* ({ path }) {
    const user = users.get(path.id);
    if (!user) {
      return yield* new NotFoundError({ message: `User ${path.id} not found` });
    }
    return user;
  }),
);

const createUser = Route.post(
  "/users",
  {
    body: Schema.Struct({
      name: Schema.String,
      email: Schema.String,
    }),
    success: User.pipe(Route.status(201)),
    errors: [ValidationError],
  },
  Effect.fnUntraced(function* ({ body }) {
    if (!body.name || body.name.length < 2) {
      return yield* new ValidationError({
        message: "Invalid input",
        fields: ["name"],
      });
    }
    const id = String(users.size + 1);
    const user = { id, name: body.name, email: body.email };
    users.set(id, user);
    return user;
  }),
);

const deleteUser = Route.del(
  "/users/:id",
  {
    path: Schema.Struct({ id: Schema.String }),
    success: Schema.Void.pipe(Route.status(204)),
    errors: [NotFoundError],
  },
  Effect.fnUntraced(function* ({ path }) {
    if (!users.has(path.id)) {
      return yield* new NotFoundError({ message: `User ${path.id} not found` });
    }
    users.delete(path.id);
  }),
);

// Build router and handler
const router = Router.make().add(getUser).add(createUser).add(deleteUser);
const fetch = Handler.toFetch(router);

describe.concurrent("Router", () => {
  describe.concurrent("route matching", () => {
    it.effect("matches GET routes", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/users/1")),
        );
        expect(response.status).toBe(200);
        const body = yield* Effect.promise(() => response.json());
        expect(body).toEqual({
          id: "1",
          name: "John Doe",
          email: "john@example.com",
        });
      }),
    );

    it.effect("matches POST routes", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(
            new Request("http://localhost/users", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: "New User",
                email: "new@example.com",
              }),
            }),
          ),
        );
        expect(response.status).toBe(201);
        const body = yield* Effect.promise(() => response.json());
        expect(body).toMatchObject({
          name: "New User",
          email: "new@example.com",
        });
      }),
    );

    it.effect("matches DELETE routes", () =>
      Effect.gen(function* () {
        // First create a user to delete
        const id = String(users.size + 1);
        users.set(id, { id, name: "To Delete", email: "delete@example.com" });

        const response = yield* Effect.promise(() =>
          fetch(
            new Request(`http://localhost/users/${id}`, {
              method: "DELETE",
            }),
          ),
        );
        expect(response.status).toBe(204);
        expect(users.has(id)).toBe(false);
      }),
    );

    it.effect("returns 404 for unmatched routes", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/nonexistent")),
        );
        expect(response.status).toBe(404);
      }),
    );
  });

  describe.concurrent("error handling", () => {
    it.effect("returns typed error responses", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/users/nonexistent")),
        );
        expect(response.status).toBe(404);
        const body = (yield* Effect.promise(() => response.json())) as {
          error: { _tag: string; message: string };
        };
        expect(body.error._tag).toBe("NotFoundError");
        expect(body.error.message).toBe("User nonexistent not found");
      }),
    );

    it.effect("returns validation errors", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(
            new Request("http://localhost/users", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: "A", email: "short@example.com" }),
            }),
          ),
        );
        expect(response.status).toBe(400);
        const body = (yield* Effect.promise(() => response.json())) as {
          error: { _tag: string; fields: string[] };
        };
        expect(body.error._tag).toBe("ValidationError");
        expect(body.error.fields).toContain("name");
      }),
    );
  });

  describe.concurrent("input validation", () => {
    it.effect("validates path parameters", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/users/1")),
        );
        expect(response.status).toBe(200);
      }),
    );

    it.effect("validates request body", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(
            new Request("http://localhost/users", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ invalid: "body" }),
            }),
          ),
        );
        expect(response.status).toBe(500); // Schema validation fails
      }),
    );

    it.effect("handles malformed JSON", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(
            new Request("http://localhost/users", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "not valid json",
            }),
          ),
        );
        expect(response.status).toBe(500);
      }),
    );
  });
});

describe.concurrent("Route", () => {
  it("creates routes with correct method", () => {
    expect(getUser.method).toBe("GET");
    expect(createUser.method).toBe("POST");
    expect(deleteUser.method).toBe("DELETE");
  });

  it("creates routes with correct pattern", () => {
    expect(getUser.pattern).toBe("/users/:id");
    expect(createUser.pattern).toBe("/users");
    expect(deleteUser.pattern).toBe("/users/:id");
  });

  it("has _tag 'Route'", () => {
    expect(getUser._tag).toBe("Route");
    expect(createUser._tag).toBe("Route");
    expect(deleteUser._tag).toBe("Route");
  });
});

describe.concurrent("Router.prefix", () => {
  it.effect("adds prefix to all routes", () =>
    Effect.gen(function* () {
      const prefixedRouter = Router.make()
        .add(getUser)
        .add(createUser)
        .prefix("/api/v1");
      const prefixedFetch = Handler.toFetch(prefixedRouter);

      // Original path should not match
      const response1 = yield* Effect.promise(() =>
        prefixedFetch(new Request("http://localhost/users/1")),
      );
      expect(response1.status).toBe(404);

      // Prefixed path should match
      const response2 = yield* Effect.promise(() =>
        prefixedFetch(new Request("http://localhost/api/v1/users/1")),
      );
      expect(response2.status).toBe(200);
    }),
  );
});
