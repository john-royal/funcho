import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  defineContract,
  FetchHandler,
  response,
  StreamBody,
} from "../src/index.js";

const User = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
});

class UserNotFoundError extends Schema.ErrorClass<UserNotFoundError>(
  "UserNotFoundError",
)({ message: Schema.String }) {}

const TestContract = defineContract({
  "/users": {
    get: {
      success: response(Schema.Array(User)),
    },
    post: {
      body: Schema.Struct({ name: Schema.String }),
      success: response(User),
    },
  },
  "/users/{id}": {
    get: {
      path: { id: Schema.NumberFromString },
      success: response(User),
      failure: response(UserNotFoundError, { status: 404 }),
    },
  },
});

const users = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];

const TestContractImpl = Layer.sync(TestContract, () => ({
  "/users": {
    get: (ctx) => Effect.succeed(ctx.respond(users)),
    post: (ctx) =>
      Effect.succeed(
        ctx.respond({ id: users.length + 1, name: ctx.body.name }),
      ),
  },
  "/users/{id}": {
    get: (ctx) =>
      Effect.gen(function* () {
        const user = users.find((u) => u.id === ctx.path.id);
        if (!user) {
          return yield* Effect.fail(
            new UserNotFoundError({ message: "User not found" }),
          );
        }
        return ctx.respond(user);
      }),
  },
}));

describe.concurrent("FetchHandler", () => {
  it.effect("handles GET request to list endpoint", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract);
      const request = new Request("http://localhost/users");
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.json());
      expect(body).toEqual(users);
    }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect("handles POST request with body", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract);
      const request = new Request("http://localhost/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Charlie" }),
      });
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.json());
      expect(body).toEqual({ id: 3, name: "Charlie" });
    }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect("handles GET request with path parameter", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract);
      const request = new Request("http://localhost/users/1");
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.json());
      expect(body).toEqual({ id: 1, name: "Alice" });
    }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect("returns 404 for user not found", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract);
      const request = new Request("http://localhost/users/999");
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(404);
      const body = yield* Effect.promise(() => response.json());
      expect(body).toEqual({ message: "User not found" });
    }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect("returns 404 for unknown route", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract);
      const request = new Request("http://localhost/unknown");
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(404);
      const body = (yield* Effect.promise(() => response.json())) as {
        error: string;
      };
      expect(body.error).toBe("NotFoundError");
    }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect("returns 405 for method not allowed", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract);
      const request = new Request("http://localhost/users", {
        method: "DELETE",
      });
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("get, post");
    }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect("returns 400 for invalid JSON body", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract);
      const request = new Request("http://localhost/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(400);
      const body = (yield* Effect.promise(() => response.json())) as {
        error: string;
      };
      expect(body.error).toBe("ValidationError");
    }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect(
    "returns 404 for NaN user id (NumberFromString decodes to NaN)",
    () =>
      Effect.gen(function* () {
        const handler = yield* FetchHandler.from(TestContract);
        // Note: Schema.NumberFromString decodes "not-a-number" as NaN,
        // which is a valid number, so validation passes but user isn't found
        const request = new Request("http://localhost/users/not-a-number");
        const response = yield* Effect.promise(() => handler(request));
        expect(response.status).toBe(404);
        const body = yield* Effect.promise(() => response.json());
        expect(body).toEqual({ message: "User not found" });
      }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect("supports custom error formatter", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract, {
        formatError: (error) => ({
          status: 500,
          body: { customError: true, type: error?.constructor?.name },
        }),
      });
      const request = new Request("http://localhost/unknown");
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(500);
      const body = (yield* Effect.promise(() => response.json())) as {
        customError: boolean;
        type: string;
      };
      expect(body.customError).toBe(true);
      expect(body.type).toBe("NotFoundError");
    }).pipe(Effect.provide(TestContractImpl)),
  );
});

describe.concurrent("StreamBody", () => {
  const StreamContract = defineContract({
    "/upload": {
      post: {
        body: StreamBody,
        success: response(Schema.Struct({ bytesReceived: Schema.Number })),
      },
    },
    "/upload-optional": {
      post: {
        body: Schema.Union([StreamBody, Schema.Null]),
        success: response(
          Schema.Struct({
            bytesReceived: Schema.Number,
            hadBody: Schema.Boolean,
          }),
        ),
      },
    },
  });

  const StreamContractImpl = Layer.sync(StreamContract, () => ({
    "/upload": {
      post: (ctx) =>
        Effect.gen(function* () {
          const reader = (ctx.body as ReadableStream<Uint8Array>).getReader();
          let bytesReceived = 0;
          while (true) {
            const result = yield* Effect.promise(() => reader.read());
            if (result.done) break;
            bytesReceived += result.value.byteLength;
          }
          return ctx.respond({ bytesReceived });
        }),
    },
    "/upload-optional": {
      post: (ctx) =>
        Effect.gen(function* () {
          if (ctx.body === null) {
            return ctx.respond({ bytesReceived: 0, hadBody: false });
          }
          const reader = (ctx.body as ReadableStream<Uint8Array>).getReader();
          let bytesReceived = 0;
          while (true) {
            const result = yield* Effect.promise(() => reader.read());
            if (result.done) break;
            bytesReceived += result.value.byteLength;
          }
          return ctx.respond({ bytesReceived, hadBody: true });
        }),
    },
  }));

  it.effect("handles StreamBody as request body", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(StreamContract);
      const data = new TextEncoder().encode("Hello, World!");
      const request = new Request("http://localhost/upload", {
        method: "POST",
        body: data,
      });
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.json());
      expect(body).toEqual({ bytesReceived: 13 });
    }).pipe(Effect.provide(StreamContractImpl)),
  );

  it.effect("handles StreamBody union with null - with body", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(StreamContract);
      const data = new TextEncoder().encode("Test data");
      const request = new Request("http://localhost/upload-optional", {
        method: "POST",
        body: data,
      });
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.json());
      expect(body).toEqual({ bytesReceived: 9, hadBody: true });
    }).pipe(Effect.provide(StreamContractImpl)),
  );

  it.effect("handles StreamBody union with null - without body", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(StreamContract);
      const request = new Request("http://localhost/upload-optional", {
        method: "POST",
      });
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(200);
      const body = yield* Effect.promise(() => response.json());
      expect(body).toEqual({ bytesReceived: 0, hadBody: false });
    }).pipe(Effect.provide(StreamContractImpl)),
  );
});
