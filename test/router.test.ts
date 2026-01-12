import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { compileContract, isRouteMatch, matchRoute } from "../src/router.js";
import { response } from "../src/schema.js";

describe.concurrent("router", () => {
  const contract = {
    "/users": {
      get: { success: response(Schema.Array(Schema.String)) },
      post: {
        body: Schema.Struct({ name: Schema.String }),
        success: response(Schema.String),
      },
    },
    "/users/{id}": {
      get: { path: { id: Schema.String }, success: response(Schema.String) },
      put: {
        path: { id: Schema.String },
        body: Schema.Struct({ name: Schema.String }),
        success: response(Schema.String),
      },
      delete: { path: { id: Schema.String }, success: response(Schema.Void) },
    },
    "/users/{userId}/posts/{postId}": {
      get: {
        path: { userId: Schema.String, postId: Schema.String },
        success: response(Schema.String),
      },
    },
  };

  describe.concurrent("compileContract", () => {
    it("compiles routes with correct patterns", () => {
      const routes = compileContract(contract);
      expect(routes).toHaveLength(3);
      expect(routes[0]?.pattern).toBe("/users");
      expect(routes[1]?.pattern).toBe("/users/{id}");
      expect(routes[2]?.pattern).toBe("/users/{userId}/posts/{postId}");
    });

    it("extracts parameter names from patterns", () => {
      const routes = compileContract(contract);
      expect(routes[0]?.paramNames).toEqual([]);
      expect(routes[1]?.paramNames).toEqual(["id"]);
      expect(routes[2]?.paramNames).toEqual(["userId", "postId"]);
    });

    it("compiles methods for each route", () => {
      const routes = compileContract(contract);
      expect(routes[0]?.methods).toEqual(["get", "post"]);
      expect(routes[1]?.methods).toEqual(["get", "put", "delete"]);
      expect(routes[2]?.methods).toEqual(["get"]);
    });
  });

  describe.concurrent("matchRoute", () => {
    const routes = compileContract(contract);

    it("matches exact paths", () => {
      const result = matchRoute(routes, "/users", "GET");
      expect(isRouteMatch(result)).toBe(true);
      if (isRouteMatch(result)) {
        expect(result.route.pattern).toBe("/users");
        expect(result.method).toBe("get");
        expect(result.params).toEqual({});
      }
    });

    it("matches paths with single parameter", () => {
      const result = matchRoute(routes, "/users/123", "GET");
      expect(isRouteMatch(result)).toBe(true);
      if (isRouteMatch(result)) {
        expect(result.route.pattern).toBe("/users/{id}");
        expect(result.params).toEqual({ id: "123" });
      }
    });

    it("matches paths with multiple parameters", () => {
      const result = matchRoute(routes, "/users/456/posts/789", "GET");
      expect(isRouteMatch(result)).toBe(true);
      if (isRouteMatch(result)) {
        expect(result.route.pattern).toBe("/users/{userId}/posts/{postId}");
        expect(result.params).toEqual({ userId: "456", postId: "789" });
      }
    });

    it("normalizes method to lowercase", () => {
      const result = matchRoute(routes, "/users", "POST");
      expect(isRouteMatch(result)).toBe(true);
      if (isRouteMatch(result)) {
        expect(result.method).toBe("post");
      }
    });

    it("returns not matched for unknown paths", () => {
      const result = matchRoute(routes, "/unknown", "GET");
      expect(isRouteMatch(result)).toBe(false);
      if (!isRouteMatch(result)) {
        expect(result.matched).toBe(false);
        expect(result.allowedMethods).toBeUndefined();
      }
    });

    it("returns allowed methods for method not allowed", () => {
      const result = matchRoute(routes, "/users", "DELETE");
      expect(isRouteMatch(result)).toBe(false);
      if (!isRouteMatch(result)) {
        expect(result.matched).toBe(false);
        expect(result.allowedMethods).toEqual(["get", "post"]);
      }
    });
  });
});
