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

    it("preserves URL-encoded characters in params (decoding handled by handler)", () => {
      const result = matchRoute(routes, "/users/hello%20world", "GET");
      expect(isRouteMatch(result)).toBe(true);
      if (isRouteMatch(result)) {
        // path-to-regexp with decode: false preserves the encoded value
        expect(result.params).toEqual({ id: "hello%20world" });
      }
    });

    it("matches paths with unicode characters", () => {
      const result = matchRoute(routes, "/users/%E2%9C%93", "GET");
      expect(isRouteMatch(result)).toBe(true);
      if (isRouteMatch(result)) {
        expect(result.params).toEqual({ id: "%E2%9C%93" });
      }
    });
  });

  describe.concurrent("special characters in static paths", () => {
    const specialContract = {
      "/api/v1.0/users": {
        get: { success: response(Schema.String) },
      },
      "/files/*.txt": {
        get: { success: response(Schema.String) },
      },
      "/search+query": {
        get: { success: response(Schema.String) },
      },
      "/path(group)": {
        get: { success: response(Schema.String) },
      },
    };

    const specialRoutes = compileContract(specialContract);

    it("escapes dot in static path segments", () => {
      const exactMatch = matchRoute(specialRoutes, "/api/v1.0/users", "GET");
      expect(isRouteMatch(exactMatch)).toBe(true);

      // Without proper escaping, '.' would match any character
      const wrongMatch = matchRoute(specialRoutes, "/api/v1X0/users", "GET");
      expect(isRouteMatch(wrongMatch)).toBe(false);
    });

    it("escapes asterisk in static path segments", () => {
      const exactMatch = matchRoute(specialRoutes, "/files/*.txt", "GET");
      expect(isRouteMatch(exactMatch)).toBe(true);

      // Without proper escaping, '*' could cause issues
      const wrongMatch = matchRoute(specialRoutes, "/files/foo.txt", "GET");
      expect(isRouteMatch(wrongMatch)).toBe(false);
    });

    it("escapes plus sign in static path segments", () => {
      const exactMatch = matchRoute(specialRoutes, "/search+query", "GET");
      expect(isRouteMatch(exactMatch)).toBe(true);

      // Without proper escaping, '+' could cause issues
      const wrongMatch = matchRoute(specialRoutes, "/searchXquery", "GET");
      expect(isRouteMatch(wrongMatch)).toBe(false);
    });

    it("escapes parentheses in static path segments", () => {
      const exactMatch = matchRoute(specialRoutes, "/path(group)", "GET");
      expect(isRouteMatch(exactMatch)).toBe(true);

      // Without proper escaping, '()' could be interpreted as regex groups
      const wrongMatch = matchRoute(specialRoutes, "/pathgroup", "GET");
      expect(isRouteMatch(wrongMatch)).toBe(false);
    });
  });
});
