import * as Schema from "effect/Schema";
import { describe, it } from "vitest";
import { defineContract } from "../src/contract.js";
import { response } from "../src/schema.js";

describe("Contract strict typing", () => {
  it("allows valid route definitions", () => {
    // This should compile without errors
    const _contract = defineContract({
      "/users": {
        get: {
          description: "List users",
          success: response(Schema.Array(Schema.String)),
        },
        post: {
          body: Schema.Struct({ name: Schema.String }),
          success: response(Schema.String),
          failure: response(Schema.String, { status: 400 }),
        },
      },
      "/users/{id}": {
        get: {
          path: { id: Schema.String },
          query: { include: Schema.optional(Schema.String) },
          headers: { authorization: Schema.String },
          success: response(Schema.String, {
            headers: { "X-Request-Id": Schema.String },
          }),
        },
      },
    });
  });

  it("rejects extraneous properties (type-level test)", () => {
    const _contract = defineContract({
      "/users": {
        // @ts-expect-error - "typo" is not a valid RouteDefinition property
        get: {
          success: response(Schema.String),
          typo: "this should cause a type error",
        },
      },
    });
  });
});
