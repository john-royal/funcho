import { RoutePattern } from "@remix-run/route-pattern";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { getContentType } from "./Annotations.js";
import {
  errorMatchesSchema,
  getStatusFromError,
  getStatusFromSchema,
  isRouteError,
  isTransformedSchema,
} from "./Error.js";
import type { AnyGatedRoute } from "./Gate.js";
import { isGatedRoute } from "./Gate.js";
import * as Headers from "./Headers.js";
import type { AnyRoute } from "./Route.js";
import { getSuccessStatus, isStream } from "./Route.js";
import type { AnyRouter, Routable } from "./Router.js";

/**
 * WinterCG-compliant fetch handler type.
 */
export type FetchHandler = (request: Request) => Promise<Response>;

/**
 * Effect-based fetch handler type that preserves requirements.
 */
export type EffectFetchHandler<R> = (
  request: Request,
) => Effect.Effect<Response, never, R>;

/**
 * Merged route info for matching.
 */
interface MatchedRoute {
  route: Routable;
  params: Record<string, string | undefined>;
}

/**
 * Build a map of route patterns for efficient matching.
 */
const buildRouteMap = (
  router: AnyRouter,
): Map<string, Array<{ pattern: RoutePattern<string>; route: Routable }>> => {
  const methodMap = new Map<
    string,
    Array<{ pattern: RoutePattern<string>; route: Routable }>
  >();

  for (const route of router.routes) {
    const method = route.method;
    if (!methodMap.has(method)) {
      methodMap.set(method, []);
    }
    const pattern = new RoutePattern(route.pattern);
    methodMap.get(method)!.push({ pattern, route });
  }

  return methodMap;
};

/**
 * Match a request to a route.
 */
const matchRoute = (
  routeMap: Map<
    string,
    Array<{ pattern: RoutePattern<string>; route: Routable }>
  >,
  method: string,
  url: URL,
): MatchedRoute | null => {
  const routes = routeMap.get(method);
  if (!routes) return null;

  for (const { pattern, route } of routes) {
    const match = pattern.match(url);
    if (match) {
      return {
        route,
        params: match.params as Record<string, string | undefined>,
      };
    }
  }

  return null;
};

/**
 * Parse query parameters from URL.
 */
const parseQuery = (url: URL): Record<string, string | string[]> => {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      query[key] = [existing, value];
    }
  }
  return query;
};

/**
 * Parse request body based on content type.
 */
const parseBody = (
  request: Request,
  bodySchema: Schema.Top | undefined,
): Effect.Effect<unknown, Error> => {
  // If no body schema or method doesn't have body, return undefined
  if (!bodySchema || request.method === "GET" || request.method === "HEAD") {
    return Effect.succeed(undefined);
  }

  // If body schema is Stream, return the request body as a stream
  if (isStream(bodySchema)) {
    if (!request.body) {
      return Effect.succeed(Stream.empty);
    }
    return Effect.succeed(
      Stream.fromReadableStream({
        evaluate: () => request.body!,
        onError: () => new Error("Stream read error"),
      }),
    );
  }

  // Parse as JSON
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return Effect.tryPromise({
      try: () => request.json(),
      catch: () => new Error("Failed to parse JSON body"),
    });
  }

  // Parse as form data
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Effect.tryPromise({
      try: async () => {
        const text = await request.text();
        const params = new URLSearchParams(text);
        const result: Record<string, string> = {};
        for (const [key, value] of params) {
          result[key] = value;
        }
        return result;
      },
      catch: () => new Error("Failed to parse form body"),
    });
  }

  // Default: try JSON
  return Effect.tryPromise({
    try: () => request.json(),
    catch: () => new Error("Failed to parse body"),
  });
};

/**
 * Validate input against schema.
 */
const validateInput = <A>(
  schema: Schema.Top | undefined,
  input: unknown,
  name: string,
): Effect.Effect<A, Error> => {
  if (!schema) {
    return Effect.succeed(input as A);
  }

  return Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.catch(() => Effect.fail(new Error(`${name} validation failed`))),
  ) as Effect.Effect<A, Error>;
};

/**
 * Build response from handler result.
 */
const buildResponse = (
  result: unknown,
  successSchema: Schema.Top,
  responseHeaders: globalThis.Headers,
): Effect.Effect<Response, Error> => {
  const status = getSuccessStatus(successSchema);

  // Check if result is a wrapped object with body
  const isWrapped =
    typeof result === "object" &&
    result !== null &&
    "body" in result &&
    !Stream.isStream(result);

  const body = isWrapped ? (result as { body: unknown }).body : result;
  const resultHeaders = isWrapped
    ? (result as { headers?: Record<string, string> }).headers
    : undefined;
  const statusText = isWrapped
    ? (result as { statusText?: string }).statusText
    : undefined;

  // Add result headers to response
  if (resultHeaders) {
    for (const [key, value] of Object.entries(resultHeaders)) {
      responseHeaders.set(key, value);
    }
  }

  // Handle stream response
  if (Stream.isStream(body)) {
    const readable = Stream.toReadableStream(body as Stream.Stream<Uint8Array>);
    return Effect.succeed(
      new Response(readable, {
        status,
        statusText,
        headers: responseHeaders,
      }),
    );
  }

  // Handle void/undefined response
  if (body === undefined || body === null) {
    return Effect.succeed(
      new Response(null, {
        status,
        statusText,
        headers: responseHeaders,
      }),
    );
  }

  // Encode response body as JSON
  const jsonBody = JSON.stringify(body);
  responseHeaders.set("content-type", "application/json");

  return Effect.succeed(
    new Response(jsonBody, {
      status,
      statusText,
      headers: responseHeaders,
    }),
  );
};

/**
 * Infer content type from encoded value.
 */
const inferContentType = (encoded: unknown): string => {
  if (typeof encoded === "string") {
    return "text/plain";
  }
  if (encoded instanceof Uint8Array) {
    return "application/octet-stream";
  }
  return "application/json";
};

/**
 * Serialize encoded value to response body.
 */
const serializeBody = (
  encoded: unknown,
  contentType: string,
): string | Uint8Array => {
  if (contentType === "text/plain" && typeof encoded === "string") {
    return encoded;
  }
  if (
    contentType === "application/octet-stream" &&
    encoded instanceof Uint8Array
  ) {
    return encoded;
  }
  // Default to JSON
  return JSON.stringify(encoded);
};

/**
 * Build error response with optional schema transformation.
 *
 * This function:
 * 1. Finds the matching error schema from the route's errors array
 * 2. Uses Schema.encodeEffect to transform the error if it's a transformed schema
 * 3. Detects content type via annotation or type inference
 * 4. Serializes appropriately (JSON for objects, raw for strings/bytes)
 */
const buildErrorResponse = (
  error: unknown,
  errorSchemas: ReadonlyArray<Schema.Top> | undefined,
  responseHeaders: globalThis.Headers,
): Effect.Effect<Response> =>
  Effect.gen(function* () {
    // Try to find a matching error schema
    let matchingSchema: Schema.Top | undefined;
    if (errorSchemas) {
      for (const schema of errorSchemas) {
        if (errorMatchesSchema(error, schema)) {
          matchingSchema = schema;
          break;
        }
      }
    }

    // Get status code from schema or fallback to error constructor
    let status = 500;
    if (matchingSchema) {
      const schemaStatus = getStatusFromSchema(matchingSchema);
      if (schemaStatus !== undefined) {
        status = schemaStatus;
      }
    } else if (typeof error === "object" && error !== null) {
      const errorCtor = (error as object).constructor;
      if (isRouteError(errorCtor)) {
        status = getStatusFromError(errorCtor);
      } else if ("_tag" in error) {
        status = 400; // Default for tagged errors without schema
      }
    }

    // Encode the error using the schema if available
    let encoded: unknown = error;
    if (matchingSchema) {
      // Cast to remove EncodingServices requirement - we handle failures via Effect.exit
      const encodeEffect = Schema.encodeEffect(matchingSchema)(
        error,
      ) as Effect.Effect<unknown, Schema.SchemaError>;
      const encodeResult = yield* Effect.exit(encodeEffect);
      if (Exit.isSuccess(encodeResult)) {
        encoded = encodeResult.value;
      }
      // If encoding fails, fall back to the raw error
    }

    // Determine content type and wrapping behavior
    let contentType: string;

    if (matchingSchema && isTransformedSchema(matchingSchema)) {
      // Transformed schemas define their own format - use it directly
      const annotatedContentType = getContentType(matchingSchema);
      contentType = annotatedContentType ?? inferContentType(encoded);
    } else {
      // Plain RouteError classes or unschematized errors - wrap in { error: ... }
      contentType = "application/json";
      encoded = { error: encoded };
    }

    responseHeaders.set("content-type", contentType);
    const body = serializeBody(encoded, contentType);

    return new Response(body, {
      status,
      headers: responseHeaders,
    });
  });

/**
 * Handle a single request.
 */
const handleRequest = (
  routeMap: Map<
    string,
    Array<{ pattern: RoutePattern<string>; route: Routable }>
  >,
  request: Request,
): Effect.Effect<Response, never, unknown> =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    const method = request.method;

    // Match route
    const matched = matchRoute(routeMap, method, url);
    if (!matched) {
      return new Response(
        JSON.stringify({ error: { _tag: "NotFound", path: url.pathname } }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      );
    }

    const { route, params } = matched;

    // Create headers service
    const { service: headersService, getResponseHeaders } = Headers.make(
      request.headers,
    );
    const headersLayer = Layer.succeed(Headers.Headers, headersService);

    // Parse query
    const query = parseQuery(url);

    // Build handler effect
    let handlerEffect: Effect.Effect<unknown, unknown, unknown>;

    if (isGatedRoute(route)) {
      // Gated route: run gate handler first, then route handler
      const gatedRoute = route as AnyGatedRoute;

      // Parse body
      const bodyResult = yield* parseBody(request, gatedRoute.config.body);

      // Validate inputs
      const validatedPath = yield* validateInput(
        gatedRoute.config.path,
        params,
        "path",
      );
      const validatedQuery = yield* validateInput(
        gatedRoute.config.query,
        query,
        "query",
      );
      const validatedHeaders = yield* validateInput(
        gatedRoute.config.headers,
        Object.fromEntries(request.headers),
        "headers",
      );
      const validatedBody = yield* validateInput(
        gatedRoute.config.body,
        bodyResult,
        "body",
      );

      const input = {
        path: validatedPath,
        query: validatedQuery,
        headers: validatedHeaders,
        body: validatedBody,
        request,
      };

      handlerEffect = Effect.gen(function* () {
        // Run gate handler to get context
        const context = yield* gatedRoute.gateHandler();
        // Provide context to route handler
        return yield* Effect.provideService(
          gatedRoute.routeHandler(input as never),
          gatedRoute.Context,
          context,
        );
      });
    } else {
      // Regular route
      const regularRoute = route as AnyRoute;

      // Parse body
      const bodyResult = yield* parseBody(request, regularRoute.config.body);

      // Validate inputs
      const validatedPath = yield* validateInput(
        regularRoute.config.path,
        params,
        "path",
      );
      const validatedQuery = yield* validateInput(
        regularRoute.config.query,
        query,
        "query",
      );
      const validatedHeaders = yield* validateInput(
        regularRoute.config.headers,
        Object.fromEntries(request.headers),
        "headers",
      );
      const validatedBody = yield* validateInput(
        regularRoute.config.body,
        bodyResult,
        "body",
      );

      const input = {
        path: validatedPath,
        query: validatedQuery,
        headers: validatedHeaders,
        body: validatedBody,
        request,
      };

      handlerEffect = regularRoute.handler(input as never);
    }

    // Provide headers service and run handler
    const result = yield* Effect.exit(
      Effect.provide(handlerEffect, headersLayer),
    );
    const responseHeaders = getResponseHeaders();

    if (Exit.isFailure(result)) {
      const cause = result.cause;
      // Check for failures
      const failures = cause.failures;
      if (failures.length > 0) {
        const failure = failures[0]!;
        if (Cause.failureIsFail(failure)) {
          return yield* buildErrorResponse(
            failure.error,
            route.config.errors,
            responseHeaders,
          );
        }
      }
      // Unexpected error (die, interrupt)
      return yield* buildErrorResponse(
        new Error("Internal server error"),
        route.config.errors,
        responseHeaders,
      );
    }

    // Build success response
    return yield* buildResponse(
      result.value,
      route.config.success,
      responseHeaders,
    );
  }).pipe(
    Effect.catch((_: unknown) =>
      Effect.succeed(
        new Response(
          JSON.stringify({
            error: { _tag: "InternalServerError", message: String(_) },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    ),
  );

/**
 * Convert a Router to an Effect-based fetch handler.
 */
export const toFetchHandler = <R extends AnyRouter>(
  router: R,
): EffectFetchHandler<never> => {
  const routeMap = buildRouteMap(router);
  return (request: Request) =>
    handleRequest(routeMap, request) as Effect.Effect<Response, never, never>;
};

/**
 * Convert a Router to a simple fetch handler.
 */
export const toFetch = <R extends AnyRouter>(router: R): FetchHandler => {
  const effectHandler = toFetchHandler(router);
  return (request: Request) => Effect.runPromise(effectHandler(request));
};
