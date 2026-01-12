import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  contentType,
  getContentType,
  getHttpStatus,
  httpStatus,
  isStreamSchema,
  StreamBody,
} from "../src/schema.js";

describe.concurrent("schema utilities", () => {
  describe.concurrent("httpStatus", () => {
    it("adds httpStatus annotation to schema", () => {
      const schema = httpStatus(Schema.String, 201);
      expect(getHttpStatus(schema)).toBe(201);
    });

    it("returns undefined for schema without annotation", () => {
      expect(getHttpStatus(Schema.String)).toBeUndefined();
    });
  });

  describe.concurrent("contentType", () => {
    it("adds contentType annotation to schema", () => {
      const schema = contentType(Schema.String, "text/plain");
      expect(getContentType(schema)).toBe("text/plain");
    });

    it("returns undefined for schema without annotation", () => {
      expect(getContentType(Schema.String)).toBeUndefined();
    });
  });

  describe.concurrent("StreamBody", () => {
    it("has octet-stream content type", () => {
      expect(getContentType(StreamBody)).toBe("application/octet-stream");
    });

    it("is recognized as stream schema", () => {
      expect(isStreamSchema(StreamBody)).toBe(true);
    });
  });

  describe.concurrent("isStreamSchema", () => {
    it("returns false for non-stream schemas", () => {
      expect(isStreamSchema(Schema.String)).toBe(false);
      expect(isStreamSchema(Schema.Number)).toBe(false);
    });

    it("returns true for schemas with octet-stream content type", () => {
      const customStream = contentType(
        Schema.Unknown,
        "application/octet-stream",
      );
      expect(isStreamSchema(customStream)).toBe(true);
    });
  });
});
