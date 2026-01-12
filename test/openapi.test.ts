import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { OpenAPI, response } from "../src/index.js";

describe.concurrent("OpenAPI", () => {
  const User = Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
  });

  class NotFoundError extends Schema.ErrorClass<NotFoundError>("NotFoundError")(
    {
      message: Schema.String,
    },
  ) {}

  const contract = {
    "/users": {
      get: {
        description: "List all users",
        success: response(Schema.Array(User)),
      },
      post: {
        description: "Create a new user",
        body: Schema.Struct({ name: Schema.String }),
        success: response(User, { status: 201 }),
      },
    },
    "/users/{id}": {
      get: {
        description: "Get user by ID",
        path: { id: Schema.Number },
        success: response(User),
        failure: response(NotFoundError, { status: 404 }),
      },
    },
  };

  it("generates valid OpenAPI 3.0 spec", () => {
    const spec = OpenAPI.from(contract, {
      title: "User API",
      version: "1.0.0",
    });
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("User API");
    expect(spec.info.version).toBe("1.0.0");
  });

  it("generates paths for all routes", () => {
    const spec = OpenAPI.from(contract, { title: "Test", version: "1.0.0" });
    expect(Object.keys(spec.paths)).toEqual(["/users", "/users/{id}"]);
  });

  it("generates operations for each method", () => {
    const spec = OpenAPI.from(contract, { title: "Test", version: "1.0.0" });
    expect(Object.keys(spec.paths["/users"] ?? {})).toEqual(["get", "post"]);
    expect(Object.keys(spec.paths["/users/{id}"] ?? {})).toEqual(["get"]);
  });

  it("includes description in operations", () => {
    const spec = OpenAPI.from(contract, { title: "Test", version: "1.0.0" });
    expect(spec.paths["/users"]?.get?.description).toBe("List all users");
    expect(spec.paths["/users"]?.post?.description).toBe("Create a new user");
  });

  it("generates path parameters", () => {
    const spec = OpenAPI.from(contract, { title: "Test", version: "1.0.0" });
    const params = spec.paths["/users/{id}"]?.get?.parameters;
    expect(params).toHaveLength(1);
    expect(params?.[0]).toMatchObject({
      name: "id",
      in: "path",
      required: true,
    });
  });

  it("generates request body for POST", () => {
    const spec = OpenAPI.from(contract, { title: "Test", version: "1.0.0" });
    const requestBody = spec.paths["/users"]?.post?.requestBody;
    expect(requestBody).toBeDefined();
    expect(requestBody?.required).toBe(true);
    expect(requestBody?.content["application/json"]).toBeDefined();
  });

  it("uses status from response() for response codes", () => {
    const spec = OpenAPI.from(contract, { title: "Test", version: "1.0.0" });
    const responses = spec.paths["/users"]?.post?.responses;
    expect(responses?.["201"]).toBeDefined();
    expect(responses?.["200"]).toBeUndefined();
  });

  it("generates error responses from failure schema", () => {
    const spec = OpenAPI.from(contract, { title: "Test", version: "1.0.0" });
    const responses = spec.paths["/users/{id}"]?.get?.responses;
    expect(responses?.["200"]).toBeDefined();
    expect(responses?.["404"]).toBeDefined();
  });

  it("includes response headers in OpenAPI spec", () => {
    const contractWithHeaders = {
      "/items": {
        get: {
          success: response(Schema.Array(Schema.String), {
            headers: {
              "X-Total-Count": Schema.Number,
              "X-Page": Schema.Number,
            },
          }),
        },
      },
    };

    const spec = OpenAPI.from(contractWithHeaders, {
      title: "Test",
      version: "1.0.0",
    });
    const getOp = spec.paths["/items"]?.get;
    expect(getOp?.responses["200"]?.headers).toBeDefined();
    expect(getOp?.responses["200"]?.headers?.["X-Total-Count"]).toBeDefined();
    expect(getOp?.responses["200"]?.headers?.["X-Page"]).toBeDefined();
  });

  it("supports union responses with multiple status codes", () => {
    const contractWithUnion = {
      "/items": {
        post: {
          body: Schema.Struct({ name: Schema.String }),
          success: response.union(
            response(Schema.Struct({ id: Schema.Number }), { status: 201 }),
            response(Schema.Struct({ id: Schema.Number }), { status: 200 }),
          ),
        },
      },
    };

    const spec = OpenAPI.from(contractWithUnion, {
      title: "Test",
      version: "1.0.0",
    });
    const responses = spec.paths["/items"]?.post?.responses;
    expect(responses?.["201"]).toBeDefined();
    expect(responses?.["200"]).toBeDefined();
  });
});
