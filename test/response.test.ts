import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  defineContract,
  FetchHandler,
  FunchoResponse,
  isResponseBody,
  Respond,
  type ResponseBody,
  ResponseBodySymbol,
} from "../src/index.js";

describe.concurrent("Response helpers", () => {
  describe.concurrent("Respond.ok", () => {
    it("creates a 200 response", () => {
      const res = Respond.ok({ message: "success" });
      expect(res.status).toBe(200);
      expect(res.data).toEqual({ message: "success" });
    });

    it("includes custom headers", () => {
      const res = Respond.ok(
        { message: "success" },
        { headers: { "X-Custom": "value" } },
      );
      expect(res.options.headers).toEqual({ "X-Custom": "value" });
    });

    it("includes statusText", () => {
      const res = Respond.ok(
        { message: "success" },
        { statusText: "All Good" },
      );
      expect(res.options.statusText).toBe("All Good");
    });
  });

  describe.concurrent("Respond.created", () => {
    it("creates a 201 response", () => {
      const res = Respond.created({ id: 1 });
      expect(res.status).toBe(201);
      expect(res.data).toEqual({ id: 1 });
    });
  });

  describe.concurrent("Respond.accepted", () => {
    it("creates a 202 response", () => {
      const res = Respond.accepted({ jobId: "abc123" });
      expect(res.status).toBe(202);
    });
  });

  describe.concurrent("Respond.noContent", () => {
    it("creates a 204 response with no data", () => {
      const res = Respond.noContent();
      expect(res.status).toBe(204);
      expect(res.data).toBeUndefined();
    });
  });

  describe.concurrent("Respond.custom", () => {
    it("creates a response with custom status", () => {
      const res = Respond.custom({ redirect: "/new-location" }, 301, {
        headers: { Location: "/new-location" },
        statusText: "Moved Permanently",
      });
      expect(res.status).toBe(301);
      expect(res.options.headers).toEqual({ Location: "/new-location" });
      expect(res.options.statusText).toBe("Moved Permanently");
    });
  });

  describe.concurrent("FunchoRespond.toResponse", () => {
    it("serializes data as JSON", () => {
      const res = Respond.ok({ name: "test" });
      const output = res.toResponse();
      expect(output.body).toBe('{"name":"test"}');
      expect(output.status).toBe(200);
    });

    it("handles null data", () => {
      const res = Respond.custom(null, 204);
      const output = res.toResponse();
      expect(output.body).toBeNull();
    });

    it("handles undefined data", () => {
      const res = Respond.noContent();
      const output = res.toResponse();
      expect(output.body).toBeNull();
    });

    it("passes through ReadableStream", () => {
      const stream = new ReadableStream();
      const res = Respond.ok(stream);
      const output = res.toResponse();
      expect(output.body).toBe(stream);
    });
  });

  describe.concurrent("isResponseBody", () => {
    it("returns true for FunchoResponse", () => {
      expect(isResponseBody(Respond.ok({}))).toBe(true);
    });

    it("returns false for plain objects", () => {
      expect(isResponseBody({ data: "test" })).toBe(false);
    });

    it("returns false for null", () => {
      expect(isResponseBody(null)).toBe(false);
    });

    it("returns true for custom ResponseBody implementation", () => {
      class CustomResponse implements ResponseBody {
        readonly [ResponseBodySymbol] = true as const;
        toResponse() {
          return { body: "custom", status: 200 };
        }
      }
      expect(isResponseBody(new CustomResponse())).toBe(true);
    });
  });
});

describe.concurrent("FetchHandler with Response helpers", () => {
  const Contract = defineContract({
    "/items": {
      get: { success: Schema.Array(Schema.String) },
      post: {
        body: Schema.Struct({ name: Schema.String }),
        success: Schema.Struct({ id: Schema.Number, name: Schema.String }),
      },
    },
    "/items/{id}": {
      delete: {
        path: { id: Schema.NumberFromString },
        success: Schema.Void,
      },
    },
  });

  const ContractImpl = Layer.sync(Contract, () => ({
    "/items": {
      get: () =>
        Effect.succeed(
          Respond.ok(["item1", "item2"], {
            headers: { "X-Total-Count": "2" },
          }),
        ),
      post: (ctx: { body: { name: string } }) =>
        Effect.succeed(
          Respond.created(
            { id: 1, name: ctx.body.name },
            { headers: { "X-Request-Id": "req-123" }, statusText: "Created" },
          ),
        ),
    },
    "/items/{id}": {
      delete: () =>
        Effect.succeed(Respond.noContent({ headers: { "X-Deleted": "true" } })),
    },
  }));

  it.effect("includes custom headers from Respond.ok", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);
      const request = new Request("http://localhost/items");
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Total-Count")).toBe("2");
      const body = yield* Effect.promise(() => response.json());
      expect(body).toEqual(["item1", "item2"]);
    }).pipe(Effect.provide(ContractImpl)),
  );

  it.effect("includes custom headers and statusText from Respond.created", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);
      const request = new Request("http://localhost/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Item" }),
      });
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(201);
      expect(response.statusText).toBe("Created");
      expect(response.headers.get("X-Request-Id")).toBe("req-123");
      const body = yield* Effect.promise(() => response.json());
      expect(body).toEqual({ id: 1, name: "New Item" });
    }).pipe(Effect.provide(ContractImpl)),
  );

  it.effect("handles Respond.noContent with custom headers", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);
      const request = new Request("http://localhost/items/1", {
        method: "DELETE",
      });
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(204);
      expect(response.headers.get("X-Deleted")).toBe("true");
    }).pipe(Effect.provide(ContractImpl)),
  );
});

describe.concurrent("Custom ResponseBody implementation", () => {
  class FileDownload implements ResponseBody {
    readonly [ResponseBodySymbol] = true as const;

    constructor(
      readonly content: string,
      readonly filename: string,
    ) {}

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

  const Contract = defineContract({
    "/export": {
      get: { success: Schema.String },
    },
  });

  const ContractImpl = Layer.sync(Contract, () => ({
    "/export": {
      get: () =>
        Effect.succeed(
          new FileDownload("id,name\n1,Alice\n2,Bob", "users.csv"),
        ),
    },
  }));

  it.effect("handles custom ResponseBody class", () =>
    Effect.gen(function* () {
      const handler = yield* FetchHandler.from(Contract);
      const request = new Request("http://localhost/export");
      const response = yield* Effect.promise(() => handler(request));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/csv");
      expect(response.headers.get("Content-Disposition")).toBe(
        'attachment; filename="users.csv"',
      );
      const body = yield* Effect.promise(() => response.text());
      expect(body).toBe("id,name\n1,Alice\n2,Bob");
    }).pipe(Effect.provide(ContractImpl)),
  );
});

describe.concurrent("OpenAPI with responseHeaders", () => {
  it("includes response headers in spec", async () => {
    const { OpenAPI } = await import("../src/index.js");

    const contract = {
      "/items": {
        get: {
          success: Schema.Array(Schema.String),
          responseHeaders: {
            "X-Total-Count": Schema.NumberFromString,
            "X-Page": Schema.NumberFromString,
          },
        },
      },
    };

    const spec = OpenAPI.from(contract, { title: "Test", version: "1.0.0" });
    const getOp = spec.paths["/items"]?.get;
    expect(getOp?.responses["200"]?.headers).toBeDefined();
    expect(getOp?.responses["200"]?.headers?.["X-Total-Count"]).toBeDefined();
    expect(getOp?.responses["200"]?.headers?.["X-Page"]).toBeDefined();
  });
});
