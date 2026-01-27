import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as Handler from "../src/Handler.js";
import * as Route from "../src/Route.js";
import * as Router from "../src/Router.js";

// ============================================================================
// Test Error Classes
// ============================================================================

class NotFoundError extends Route.Error(
  "NotFoundError",
  404,
)({
  message: Schema.String,
}) {}

class UnauthorizedError extends Route.Error("UnauthorizedError", 401)({}) {}

// ============================================================================
// Transformed Error Schemas
// ============================================================================

// Cloudflare-style error response
const CloudflareErrorResponse = Schema.Struct({
  success: Schema.Literal(false),
  result: Schema.Null,
  errors: Schema.Array(
    Schema.Struct({
      code: Schema.Number,
      message: Schema.String,
    }),
  ),
  messages: Schema.Array(Schema.String),
});

const CloudflareNotFoundError = NotFoundError.pipe(
  Schema.encodeTo(CloudflareErrorResponse, {
    encode: SchemaGetter.transform((error) => ({
      success: false as const,
      result: null,
      errors: [{ code: 10007, message: error.message }],
      messages: [],
    })),
    decode: SchemaGetter.transform(
      (resp) =>
        new NotFoundError({
          message: resp.errors[0]?.message ?? "Not found",
        }),
    ),
  }),
);

// Plain text error
const PlainTextUnauthorizedError = UnauthorizedError.pipe(
  Schema.encodeTo(Schema.String, {
    encode: SchemaGetter.transform(() => "Unauthorized"),
    decode: SchemaGetter.transform(() => new UnauthorizedError({})),
  }),
  Route.contentType("text/plain"),
);

// ============================================================================
// Test Routes
// ============================================================================

// Route with transformed Cloudflare-style error
const getResourceCF = Route.get(
  "/cf/resources/:id",
  {
    path: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ id: Schema.String, name: Schema.String }).pipe(
      Route.status(200),
    ),
    errors: [CloudflareNotFoundError],
  },
  Effect.fnUntraced(function* ({ path }) {
    if (path.id === "missing") {
      return yield* new NotFoundError({ message: "Resource not found" });
    }
    return { id: path.id, name: "Test Resource" };
  }),
);

// Route with plain text error
const getProtectedResource = Route.get(
  "/protected/resources/:id",
  {
    path: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ id: Schema.String }).pipe(Route.status(200)),
    errors: [PlainTextUnauthorizedError],
  },
  Effect.fnUntraced(function* ({ path }) {
    // Simulate auth check
    if (path.id === "secret") {
      return yield* new UnauthorizedError({});
    }
    return { id: path.id };
  }),
);

// Route with plain (non-transformed) error for comparison
const getResourcePlain = Route.get(
  "/plain/resources/:id",
  {
    path: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ id: Schema.String, name: Schema.String }).pipe(
      Route.status(200),
    ),
    errors: [NotFoundError],
  },
  Effect.fnUntraced(function* ({ path }) {
    if (path.id === "missing") {
      return yield* new NotFoundError({ message: "Resource not found" });
    }
    return { id: path.id, name: "Test Resource" };
  }),
);

// Build router and handler
const router = Router.make()
  .add(getResourceCF)
  .add(getProtectedResource)
  .add(getResourcePlain);
const fetch = Handler.toFetch(router);

// ============================================================================
// Tests
// ============================================================================

describe.concurrent("Error Transformation", () => {
  describe.concurrent("Cloudflare-style transformed errors", () => {
    it.effect("transforms error to Cloudflare format", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/cf/resources/missing")),
        );

        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toBe("application/json");

        const body = (yield* Effect.promise(() => response.json())) as {
          success: boolean;
          result: null;
          errors: Array<{ code: number; message: string }>;
          messages: string[];
        };

        expect(body.success).toBe(false);
        expect(body.result).toBe(null);
        expect(body.errors).toHaveLength(1);
        expect(body.errors[0]?.code).toBe(10007);
        expect(body.errors[0]?.message).toBe("Resource not found");
        expect(body.messages).toEqual([]);
      }),
    );

    it.effect("returns success normally when no error", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/cf/resources/123")),
        );

        expect(response.status).toBe(200);
        const body = (yield* Effect.promise(() => response.json())) as {
          id: string;
          name: string;
        };
        expect(body.id).toBe("123");
        expect(body.name).toBe("Test Resource");
      }),
    );
  });

  describe.concurrent("Plain text errors", () => {
    it.effect("returns plain text error response", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/protected/resources/secret")),
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("content-type")).toBe("text/plain");

        const body = yield* Effect.promise(() => response.text());
        expect(body).toBe("Unauthorized");
      }),
    );

    it.effect("returns success normally when authorized", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/protected/resources/public")),
        );

        expect(response.status).toBe(200);
        const body = (yield* Effect.promise(() => response.json())) as {
          id: string;
        };
        expect(body.id).toBe("public");
      }),
    );
  });

  describe.concurrent("Plain (non-transformed) errors", () => {
    it.effect("wraps plain errors in { error: ... } format", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/plain/resources/missing")),
        );

        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toBe("application/json");

        const body = (yield* Effect.promise(() => response.json())) as {
          error: { _tag: string; message: string };
        };

        // Plain errors should be wrapped in { error: ... }
        expect(body.error).toBeDefined();
        expect(body.error._tag).toBe("NotFoundError");
        expect(body.error.message).toBe("Resource not found");
      }),
    );
  });

  describe.concurrent("Status code extraction", () => {
    it.effect("extracts status from transformed schema", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/cf/resources/missing")),
        );
        expect(response.status).toBe(404);
      }),
    );

    it.effect("extracts status from plain RouteError", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/plain/resources/missing")),
        );
        expect(response.status).toBe(404);
      }),
    );

    it.effect("extracts status from plain text error schema", () =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          fetch(new Request("http://localhost/protected/resources/secret")),
        );
        expect(response.status).toBe(401);
      }),
    );
  });
});
