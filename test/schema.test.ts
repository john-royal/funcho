import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  getBodySchema,
  getDefaultStatus,
  getResponseSchemas,
  getStatuses,
  isResponseSchema,
  isResponseUnion,
  response,
  StreamBody,
} from "../src/schema.js";

describe.concurrent("response", () => {
  describe.concurrent("response()", () => {
    it("creates a response schema with defaults", () => {
      const res = response(Schema.String);
      expect(isResponseSchema(res)).toBe(true);
      expect(res.status).toBe(200);
      expect(res.headers).toEqual({});
    });

    it("creates a response schema with custom status", () => {
      const res = response(Schema.String, { status: 201 });
      expect(res.status).toBe(201);
    });

    it("creates a response schema with custom headers", () => {
      const res = response(Schema.String, {
        headers: { "X-Custom": Schema.Number },
      });
      expect(res.headers).toHaveProperty("X-Custom");
    });

    it("creates a response schema with both status and headers", () => {
      const res = response(Schema.String, {
        status: 201,
        headers: { "X-Request-Id": Schema.String },
      });
      expect(res.status).toBe(201);
      expect(res.headers).toHaveProperty("X-Request-Id");
    });
  });

  describe.concurrent("response.union()", () => {
    it("creates a union of response schemas", () => {
      const union = response.union(
        response(Schema.String, { status: 200 }),
        response(Schema.String, { status: 201 }),
      );
      expect(isResponseUnion(union)).toBe(true);
      expect(union.responses).toHaveLength(2);
    });
  });

  describe.concurrent("getResponseSchemas()", () => {
    it("returns array with single schema for ResponseSchema", () => {
      const res = response(Schema.String);
      const schemas = getResponseSchemas(res);
      expect(schemas).toHaveLength(1);
      expect(schemas[0]).toBe(res);
    });

    it("returns all schemas for ResponseUnion", () => {
      const union = response.union(
        response(Schema.String, { status: 200 }),
        response(Schema.Number, { status: 201 }),
      );
      const schemas = getResponseSchemas(union);
      expect(schemas).toHaveLength(2);
    });
  });

  describe.concurrent("getBodySchema()", () => {
    it("returns body schema from ResponseSchema", () => {
      const res = response(Schema.String);
      const body = getBodySchema(res);
      expect(body).toBe(Schema.String);
    });

    it("returns single body from union with one response", () => {
      const union = response.union(response(Schema.String, { status: 200 }));
      const body = getBodySchema(union);
      expect(body).toBe(Schema.String);
    });

    it("returns union schema from multiple responses", () => {
      const union = response.union(
        response(Schema.String, { status: 200 }),
        response(Schema.Number, { status: 201 }),
      );
      const body = getBodySchema(union);
      expect(body.ast._tag).toBe("Union");
    });
  });

  describe.concurrent("getStatuses()", () => {
    it("returns status from ResponseSchema", () => {
      const res = response(Schema.String, { status: 201 });
      expect(getStatuses(res)).toEqual([201]);
    });

    it("returns all statuses from union", () => {
      const union = response.union(
        response(Schema.String, { status: 200 }),
        response(Schema.String, { status: 201 }),
        response(Schema.String, { status: 204 }),
      );
      expect(getStatuses(union)).toEqual([200, 201, 204]);
    });
  });

  describe.concurrent("getDefaultStatus()", () => {
    it("returns status from ResponseSchema", () => {
      const res = response(Schema.String, { status: 201 });
      expect(getDefaultStatus(res)).toBe(201);
    });

    it("returns first status from union", () => {
      const union = response.union(
        response(Schema.String, { status: 201 }),
        response(Schema.String, { status: 200 }),
      );
      expect(getDefaultStatus(union)).toBe(201);
    });

    it("returns 200 for empty union", () => {
      const union = response.union();
      expect(getDefaultStatus(union)).toBe(200);
    });
  });

  describe.concurrent("isResponseSchema()", () => {
    it("returns true for response schema", () => {
      expect(isResponseSchema(response(Schema.String))).toBe(true);
    });

    it("returns false for plain objects", () => {
      expect(isResponseSchema({})).toBe(false);
      expect(isResponseSchema(null)).toBe(false);
      expect(isResponseSchema(Schema.String)).toBe(false);
    });
  });

  describe.concurrent("isResponseUnion()", () => {
    it("returns true for response union", () => {
      expect(isResponseUnion(response.union())).toBe(true);
    });

    it("returns false for response schema", () => {
      expect(isResponseUnion(response(Schema.String))).toBe(false);
    });
  });
});

describe.concurrent("StreamBody", () => {
  it("is a schema for ReadableStream", () => {
    const stream = new ReadableStream();
    const decoded = Schema.decodeUnknownSync(StreamBody)(stream);
    expect(decoded).toBe(stream);
  });
});
