import * as Schema from "effect/Schema";
import { describe, it } from "vitest";
import { defineContract } from "../src/contract.js";

describe("Contract strict typing", () => {
  it("allows valid route definitions", () => {
    // This should compile without errors
    const _contract = defineContract({
      "/users": {
        get: {
          description: "List users",
          success: Schema.Array(Schema.String),
        },
        post: {
          body: Schema.Struct({ name: Schema.String }),
          success: Schema.String,
          failure: Schema.String,
        },
      },
      "/users/{id}": {
        get: {
          path: { id: Schema.String },
          query: { include: Schema.optional(Schema.String) },
          headers: { authorization: Schema.String },
          success: Schema.String,
          responseHeaders: { "X-Request-Id": Schema.String },
        },
      },
    });
  });

  it("rejects extraneous properties (type-level test)", () => {
    const _contract = defineContract({
      "/users": {
        // @ts-expect-error - "typo" is not a valid RouteDefinition property
        get: {
          success: Schema.String,
          typo: "this should cause a type error",
        },
      },
    });
  });
});
