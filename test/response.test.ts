import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { defineContract, FetchHandler, response } from "../src/index.js";

describe.concurrent("Typed responses with ctx.respond", () => {
  const Contract = defineContract({
    "/items": {
      get: {
        success: response(Schema.Array(Schema.String), {
          headers: { "X-Total-Count": Schema.Number },
        }),
      },
      post: {
        body: Schema.Struct({ name: Schema.String }),
        success: response(
          Schema.Struct({ id: Schema.Number, name: Schema.String }),
          {
            status: 201,
            headers: { "X-Request-Id": Schema.String },
          },
        ),
      },
    },
    "/items/{id}": {
      delete: {
        path: { id: Schema.NumberFromString },
        success: response(Schema.Void, { status: 204 }),
      },
    },
  });

  const ContractImpl = Layer.sync(Contract, () => ({
    "/items": {
      get: (ctx) =>
        Effect.succeed(
          ctx.respond(["item1", "item2"], {
            headers: { "X-Total-Count": 2 },
          }),
        ),
      post: (ctx) =>
        Effect.succeed(
          ctx.respond(
            { id: 1, name: ctx.body.name },
            { status: 201, headers: { "X-Request-Id": "req-123" } },
          ),
        ),
    },
    "/items/{id}": {
      delete: (ctx) => Effect.succeed(ctx.respond(undefined)),
    },
  }));

  it.effect("includes typed headers in response", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);
      const request = new Request("http://localhost/items");
      const res = yield* Effect.promise(() => handler(request));
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Total-Count")).toBe("2");
      const body = yield* Effect.promise(() => res.json());
      expect(body).toEqual(["item1", "item2"]);
    }).pipe(Effect.provide(ContractImpl)),
  );

  it.effect("uses status from ctx.respond", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);
      const request = new Request("http://localhost/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Item" }),
      });
      const res = yield* Effect.promise(() => handler(request));
      expect(res.status).toBe(201);
      expect(res.headers.get("X-Request-Id")).toBe("req-123");
      const body = yield* Effect.promise(() => res.json());
      expect(body).toEqual({ id: 1, name: "New Item" });
    }).pipe(Effect.provide(ContractImpl)),
  );

  it.effect("handles 204 No Content responses", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);
      const request = new Request("http://localhost/items/1", {
        method: "DELETE",
      });
      const res = yield* Effect.promise(() => handler(request));
      expect(res.status).toBe(204);
    }).pipe(Effect.provide(ContractImpl)),
  );
});

describe.concurrent("Auto-wrapped contract failures", () => {
  class NotFoundError extends Schema.ErrorClass<NotFoundError>("NotFoundError")(
    {
      message: Schema.String,
    },
  ) {}

  class ConflictError extends Schema.ErrorClass<ConflictError>("ConflictError")(
    {
      message: Schema.String,
      resource: Schema.String,
    },
  ) {}

  const Contract = defineContract({
    "/items/{id}": {
      get: {
        path: { id: Schema.NumberFromString },
        success: response(
          Schema.Struct({ id: Schema.Number, name: Schema.String }),
        ),
        failure: response(NotFoundError, { status: 404 }),
      },
      put: {
        path: { id: Schema.NumberFromString },
        body: Schema.Struct({ name: Schema.String }),
        success: response(
          Schema.Struct({ id: Schema.Number, name: Schema.String }),
        ),
        failure: response.union(
          response(NotFoundError, { status: 404 }),
          response(ConflictError, { status: 409 }),
        ),
      },
    },
  });

  const items = [{ id: 1, name: "Item 1" }];

  const ContractImpl = Layer.sync(Contract, () => ({
    "/items/{id}": {
      get: (ctx) =>
        Effect.gen(function* () {
          const item = items.find((i) => i.id === ctx.path.id);
          if (!item) {
            return yield* Effect.fail(
              new NotFoundError({ message: "Item not found" }),
            );
          }
          return ctx.respond(item);
        }),
      put: (ctx) =>
        Effect.gen(function* () {
          const index = items.findIndex((i) => i.id === ctx.path.id);
          if (index === -1) {
            return yield* Effect.fail(
              new NotFoundError({ message: "Item not found" }),
            );
          }
          if (ctx.body.name === "conflict") {
            return yield* Effect.fail(
              new ConflictError({
                message: "Name conflict",
                resource: "item",
              }),
            );
          }
          items[index] = { id: ctx.path.id, name: ctx.body.name };
          return ctx.respond(items[index]!);
        }),
    },
  }));

  it.effect("auto-wraps contract failure with correct status", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);
      const request = new Request("http://localhost/items/999");
      const res = yield* Effect.promise(() => handler(request));
      expect(res.status).toBe(404);
      const body = yield* Effect.promise(() => res.json());
      expect(body).toEqual({ message: "Item not found" });
    }).pipe(Effect.provide(ContractImpl)),
  );

  it.effect("supports union failure types with different statuses", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);

      // Test 404
      const res404 = yield* Effect.promise(() =>
        handler(
          new Request("http://localhost/items/999", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "test" }),
          }),
        ),
      );
      expect(res404.status).toBe(404);

      // Test 409
      const res409 = yield* Effect.promise(() =>
        handler(
          new Request("http://localhost/items/1", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "conflict" }),
          }),
        ),
      );
      expect(res409.status).toBe(409);
      const body = yield* Effect.promise(() => res409.json());
      expect(body).toEqual({ message: "Name conflict", resource: "item" });
    }).pipe(Effect.provide(ContractImpl)),
  );
});

describe.concurrent("Response with inferred status", () => {
  const Contract = defineContract({
    "/simple": {
      get: {
        success: response(Schema.String),
      },
    },
  });

  const ContractImpl = Layer.sync(Contract, () => ({
    "/simple": {
      get: (ctx) => Effect.succeed(ctx.respond("hello")),
    },
  }));

  it.effect("uses default status 200 when not specified", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);
      const request = new Request("http://localhost/simple");
      const res = yield* Effect.promise(() => handler(request));
      expect(res.status).toBe(200);
      const body = yield* Effect.promise(() => res.text());
      expect(JSON.parse(body)).toBe("hello");
    }).pipe(Effect.provide(ContractImpl)),
  );
});

describe.concurrent("Union responses", () => {
  const Contract = defineContract({
    "/items": {
      post: {
        body: Schema.Struct({ name: Schema.String }),
        success: response.union(
          response(
            Schema.Struct({ id: Schema.Number, created: Schema.Boolean }),
            {
              status: 201,
            },
          ),
          response(
            Schema.Struct({ id: Schema.Number, created: Schema.Boolean }),
            {
              status: 200,
            },
          ),
        ),
      },
    },
  });

  const existingItems: Record<string, number> = { existing: 1 };
  let nextId = 2;

  const ContractImpl = Layer.sync(Contract, () => ({
    "/items": {
      post: (ctx) => {
        if (existingItems[ctx.body.name]) {
          return Effect.succeed(
            ctx.respond(
              { id: existingItems[ctx.body.name]!, created: false },
              { status: 200 },
            ),
          );
        }
        const id = nextId++;
        existingItems[ctx.body.name] = id;
        return Effect.succeed(
          ctx.respond({ id, created: true }, { status: 201 }),
        );
      },
    },
  }));

  it.effect("returns 201 for new items", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);
      const request = new Request("http://localhost/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "new-item" }),
      });
      const res = yield* Effect.promise(() => handler(request));
      expect(res.status).toBe(201);
      const body = (yield* Effect.promise(() => res.json())) as {
        created: boolean;
      };
      expect(body.created).toBe(true);
    }).pipe(Effect.provide(ContractImpl)),
  );

  it.effect("returns 200 for existing items", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);
      const request = new Request("http://localhost/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "existing" }),
      });
      const res = yield* Effect.promise(() => handler(request));
      expect(res.status).toBe(200);
      const body = (yield* Effect.promise(() => res.json())) as {
        created: boolean;
      };
      expect(body.created).toBe(false);
    }).pipe(Effect.provide(ContractImpl)),
  );
});
