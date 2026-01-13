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

  it.effect("supports custom statusText in error formatter", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract, {
        formatError: () => ({
          status: 503,
          statusText: "Service Temporarily Unavailable",
          body: { error: "Service unavailable" },
        }),
      });
      const request = new Request("http://localhost/unknown");
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(503);
      expect(response.statusText).toBe("Service Temporarily Unavailable");
    }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect("supports custom headers in error formatter", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract, {
        formatError: () => ({
          status: 503,
          headers: { "Retry-After": "300", "X-Custom-Header": "custom-value" },
          body: { error: "Service unavailable" },
        }),
      });
      const request = new Request("http://localhost/unknown");
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("300");
      expect(response.headers.get("X-Custom-Header")).toBe("custom-value");
      // Default Content-Type should still be set
      expect(response.headers.get("Content-Type")).toBe("application/json");
    }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect("allows overriding Content-Type header in error formatter", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract, {
        formatError: () => ({
          status: 500,
          headers: { "Content-Type": "text/plain" },
          body: "Internal Server Error",
        }),
      });
      const request = new Request("http://localhost/unknown");
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(500);
      expect(response.headers.get("Content-Type")).toBe("text/plain");
      // Body is still JSON-stringified when using ErrorResponse
      const body = yield* Effect.promise(() => response.text());
      expect(body).toBe('"Internal Server Error"');
    }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect("supports returning Response directly from error formatter", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(TestContract, {
        formatError: () =>
          new Response("Internal Server Error", {
            status: 500,
            statusText: "Internal Server Error",
            headers: { "Content-Type": "text/plain" },
          }),
      });
      const request = new Request("http://localhost/unknown");
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(500);
      expect(response.statusText).toBe("Internal Server Error");
      expect(response.headers.get("Content-Type")).toBe("text/plain");
      // Body is passed through as-is when returning Response
      const body = yield* Effect.promise(() => response.text());
      expect(body).toBe("Internal Server Error");
    }).pipe(Effect.provide(TestContractImpl)),
  );

  it.effect(
    "merges default Allow header with custom headers for MethodNotAllowed",
    () =>
      Effect.gen(function* () {
        const handler = yield* FetchHandler.from(TestContract, {
          formatError: () => ({
            status: 405,
            headers: { "X-Custom": "value" },
            body: { error: "Method not allowed" },
          }),
        });
        const request = new Request("http://localhost/users", {
          method: "DELETE",
        });
        const response = yield* Effect.promise(() => handler(request));
        expect(response.status).toBe(405);
        // Both Allow (default) and X-Custom (user) headers should be present
        expect(response.headers.get("Allow")).toBe("get, post");
        expect(response.headers.get("X-Custom")).toBe("value");
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

  it.effect("consumes stream body on handler error", () =>
    Effect.gen(function* () {
      class HandlerError extends Schema.ErrorClass<HandlerError>(
        "HandlerError",
      )({ message: Schema.String }) {}

      const ErrorContract = defineContract({
        "/upload-error": {
          post: {
            body: StreamBody,
            success: response(Schema.Struct({ ok: Schema.Boolean })),
            failure: response(HandlerError, { status: 500 }),
          },
        },
      });

      let streamConsumed = false;
      const ErrorContractImpl = Layer.sync(ErrorContract, () => ({
        "/upload-error": {
          post: () => Effect.fail(new HandlerError({ message: "Test error" })),
        },
      }));

      const errorHandler = yield* FetchHandler.from(ErrorContract).pipe(
        Effect.provide(ErrorContractImpl),
      );

      // Create a custom stream that tracks consumption
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("test data"));
          controller.close();
        },
      });

      const req = new Request("http://localhost/upload-error", {
        method: "POST",
        body: stream.pipeThrough(
          new TransformStream({
            transform(chunk, controller) {
              controller.enqueue(chunk);
            },
            flush() {
              streamConsumed = true;
            },
          }),
        ),
        duplex: "half",
      } as RequestInit);

      const res = yield* Effect.promise(() => errorHandler(req));
      expect(res.status).toBe(500);
      expect(streamConsumed).toBe(true);
    }),
  );

  it.effect("does not cancel stream body on success", () =>
    Effect.gen(function* () {
      let streamCanceled = false;

      const successHandler = yield* FetchHandler.from(StreamContract).pipe(
        Effect.provide(StreamContractImpl),
      );

      // Create a custom stream that tracks cancellation
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("test data"));
          controller.close();
        },
        cancel() {
          streamCanceled = true;
        },
      });

      const req = new Request("http://localhost/upload", {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit);

      const res = yield* Effect.promise(() => successHandler(req));
      expect(res.status).toBe(200);
      expect(streamCanceled).toBe(false);
    }),
  );
});

describe.concurrent("decodePath option", () => {
  it.effect("decodes URL-encoded path parameters by default", () =>
    Effect.gen(function* () {
      const DecodeContract = defineContract({
        "/items/{id}": {
          get: {
            path: { id: Schema.String },
            success: response(Schema.Struct({ id: Schema.String })),
          },
        },
      });

      const DecodeImpl = Layer.sync(DecodeContract, () => ({
        "/items/{id}": {
          get: (ctx) => Effect.succeed(ctx.respond({ id: ctx.path.id })),
        },
      }));

      const handler = yield* FetchHandler.from(DecodeContract).pipe(
        Effect.provide(DecodeImpl),
      );

      // %20 should be decoded to space
      const req = new Request("http://localhost/items/hello%20world");
      const res = yield* Effect.promise(() => handler(req));
      expect(res.status).toBe(200);
      const body = yield* Effect.promise(() => res.json());
      expect(body).toEqual({ id: "hello world" });
    }),
  );

  it.effect("decodes unicode characters in path parameters", () =>
    Effect.gen(function* () {
      const UnicodeContract = defineContract({
        "/items/{id}": {
          get: {
            path: { id: Schema.String },
            success: response(Schema.Struct({ id: Schema.String })),
          },
        },
      });

      const UnicodeImpl = Layer.sync(UnicodeContract, () => ({
        "/items/{id}": {
          get: (ctx) => Effect.succeed(ctx.respond({ id: ctx.path.id })),
        },
      }));

      const handler = yield* FetchHandler.from(UnicodeContract).pipe(
        Effect.provide(UnicodeImpl),
      );

      // %E2%9C%93 is the UTF-8 encoding of ✓
      const req = new Request("http://localhost/items/%E2%9C%93");
      const res = yield* Effect.promise(() => handler(req));
      expect(res.status).toBe(200);
      const body = yield* Effect.promise(() => res.json());
      expect(body).toEqual({ id: "✓" });
    }),
  );

  it.effect("does not decode when decodePath is false", () =>
    Effect.gen(function* () {
      const RawContract = defineContract({
        "/items/{key}": {
          get: {
            path: { key: Schema.String },
            query: { urlencoded: Schema.optional(Schema.String) },
            decodePath: false,
            success: response(Schema.Struct({ key: Schema.String })),
          },
        },
      });

      const RawImpl = Layer.sync(RawContract, () => ({
        "/items/{key}": {
          get: (ctx) => Effect.succeed(ctx.respond({ key: ctx.path.key })),
        },
      }));

      const handler = yield* FetchHandler.from(RawContract).pipe(
        Effect.provide(RawImpl),
      );

      // With decodePath: false, %20 should remain as-is
      const req = new Request("http://localhost/items/hello%20world");
      const res = yield* Effect.promise(() => handler(req));
      expect(res.status).toBe(200);
      const body = yield* Effect.promise(() => res.json());
      expect(body).toEqual({ key: "hello%20world" });
    }),
  );

  it.effect(
    "returns 400 for malformed URL encoding when decodePath is true",
    () =>
      Effect.gen(function* () {
        const MalformedContract = defineContract({
          "/items/{id}": {
            get: {
              path: { id: Schema.String },
              success: response(Schema.Struct({ id: Schema.String })),
            },
          },
        });

        const MalformedImpl = Layer.sync(MalformedContract, () => ({
          "/items/{id}": {
            get: (ctx) => Effect.succeed(ctx.respond({ id: ctx.path.id })),
          },
        }));

        const handler = yield* FetchHandler.from(MalformedContract).pipe(
          Effect.provide(MalformedImpl),
        );

        // %ZZ is invalid percent-encoding
        const req = new Request("http://localhost/items/%ZZ");
        const res = yield* Effect.promise(() => handler(req));
        expect(res.status).toBe(400);
        const body = (yield* Effect.promise(() => res.json())) as {
          error: string;
          message: string;
        };
        expect(body.error).toBe("ValidationError");
        expect(body.message).toContain("Invalid URL encoding");
      }),
  );

  it.effect("allows malformed URL encoding when decodePath is false", () =>
    Effect.gen(function* () {
      const AllowMalformedContract = defineContract({
        "/items/{key}": {
          get: {
            path: { key: Schema.String },
            decodePath: false,
            success: response(Schema.Struct({ key: Schema.String })),
          },
        },
      });

      const AllowMalformedImpl = Layer.sync(AllowMalformedContract, () => ({
        "/items/{key}": {
          get: (ctx) => Effect.succeed(ctx.respond({ key: ctx.path.key })),
        },
      }));

      const handler = yield* FetchHandler.from(AllowMalformedContract).pipe(
        Effect.provide(AllowMalformedImpl),
      );

      // %ZZ is invalid percent-encoding but should pass through when decodePath: false
      const req = new Request("http://localhost/items/%ZZ");
      const res = yield* Effect.promise(() => handler(req));
      expect(res.status).toBe(200);
      const body = yield* Effect.promise(() => res.json());
      expect(body).toEqual({ key: "%ZZ" });
    }),
  );
});

describe.concurrent("query parameters", () => {
  it.effect("decodes query parameters by default", () =>
    Effect.gen(function* () {
      const DecodeContract = defineContract({
        "/items": {
          get: {
            query: { id: Schema.String },
            success: response(Schema.Struct({ id: Schema.String })),
          },
        },
      });
      const DecodeImpl = Layer.sync(DecodeContract, () => ({
        "/items": {
          get: (ctx) => Effect.succeed(ctx.respond({ id: ctx.query.id })),
        },
      }));
      const handler = yield* FetchHandler.from(DecodeContract).pipe(
        Effect.provide(DecodeImpl),
      );
      const req = new Request("http://localhost/items?id=123");
      const res = yield* Effect.promise(() => handler(req));
      expect(res.status).toBe(200);
      const body = yield* Effect.promise(() => res.json());
      expect(body).toEqual({ id: "123" });
    }),
  );

  it.effect("honors withDecodingDefault", () =>
    Effect.gen(function* () {
      const DecodeContract = defineContract({
        "/items": {
          get: {
            query: {
              id: Schema.String.pipe(Schema.withDecodingDefault(() => "456")),
            },
            success: response(Schema.Struct({ id: Schema.String })),
          },
        },
      });
      const DecodeImpl = Layer.sync(DecodeContract, () => ({
        "/items": {
          get: (ctx) => Effect.succeed(ctx.respond({ id: ctx.query.id })),
        },
      }));
      const handler = yield* FetchHandler.from(DecodeContract).pipe(
        Effect.provide(DecodeImpl),
      );
      const req = new Request("http://localhost/items");
      const res = yield* Effect.promise(() => handler(req));
      expect(res.status).toBe(200);
      const body = yield* Effect.promise(() => res.json());
      expect(body).toEqual({ id: "456" });
    }),
  );
});
