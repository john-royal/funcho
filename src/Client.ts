import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { AnyRouteError, InstanceOf } from "./Error.js";
import type { HttpMethod, PathInput, RouteConfig } from "./Route.js";
import type { AnyRouter, Routable } from "./Router.js";

/**
 * Extract path parameters from a pattern string.
 * E.g., "/users/:id/posts/:postId" → { id: string; postId: string }
 */
type ExtractPathParams<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ExtractPathParams<`/${Rest}`>]: string }
    : T extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : Record<string, never>;

/**
 * Infer the type from a schema, with void as undefined.
 */
type SchemaType<S> =
  S extends Schema.Schema<infer T>
    ? T extends void
      ? undefined
      : T
    : undefined;

/**
 * Client request options for a route.
 */
type ClientRequestOptions<
  TPattern extends PathInput,
  _TPath extends Schema.Top,
  TQuery extends Schema.Top,
  THeaders extends Schema.Top,
  TBody extends Schema.Top,
> = {
  /** Path parameters extracted from the URL pattern */
  path: ExtractPathParams<TPattern> extends Record<string, never>
    ? never
    : ExtractPathParams<TPattern>;
  /** Query parameters */
  query: SchemaType<TQuery> extends undefined ? never : SchemaType<TQuery>;
  /** Request headers */
  headers: SchemaType<THeaders> extends undefined
    ? never
    : SchemaType<THeaders>;
  /** Request body */
  body: SchemaType<TBody> extends undefined ? never : SchemaType<TBody>;
};

/**
 * Simplify a type by filtering out 'never' properties.
 */
type SimplifyOptions<T> = {
  [K in keyof T as T[K] extends never ? never : K]: T[K];
};

/**
 * Final options type - becomes undefined if empty object.
 */
type FinalOptions<T> = keyof T extends never ? undefined : T;

/**
 * Client response for a route.
 */
type ClientResponse<TSuccess extends Schema.Top> =
  TSuccess extends typeof Schema.Void
    ? undefined
    : Schema.Schema.Type<TSuccess>;

/**
 * Union of error instances from error classes.
 */
type ErrorsUnion<TErrors extends ReadonlyArray<AnyRouteError>> =
  TErrors extends readonly [] ? never : InstanceOf<TErrors[number]>;

/**
 * Client method for a single route.
 */
type ClientMethod<
  TPattern extends PathInput,
  TPath extends Schema.Top,
  TQuery extends Schema.Top,
  THeaders extends Schema.Top,
  TBody extends Schema.Top,
  TSuccess extends Schema.Top,
  TErrors extends ReadonlyArray<AnyRouteError>,
> = FinalOptions<
  SimplifyOptions<
    ClientRequestOptions<TPattern, TPath, TQuery, THeaders, TBody>
  >
> extends void
  ? () => Effect.Effect<
      ClientResponse<TSuccess>,
      ErrorsUnion<TErrors> | ClientError
    >
  : (
      options: SimplifyOptions<
        ClientRequestOptions<TPattern, TPath, TQuery, THeaders, TBody>
      >,
    ) => Effect.Effect<
      ClientResponse<TSuccess>,
      ErrorsUnion<TErrors> | ClientError
    >;

/**
 * Generate a client method name from an HTTP method.
 */
type MethodName<M extends HttpMethod> = M extends "GET"
  ? "get"
  : M extends "POST"
    ? "create"
    : M extends "PUT"
      ? "update"
      : M extends "PATCH"
        ? "patch"
        : M extends "DELETE"
          ? "delete"
          : M extends "HEAD"
            ? "head"
            : "options";

/**
 * Parse path segments and build nested structure.
 * E.g., "/users/:id" → { users: { get: ... } }
 */
type ParsePath<
  P extends PathInput,
  Method extends HttpMethod,
  TPath extends Schema.Top,
  TQuery extends Schema.Top,
  THeaders extends Schema.Top,
  TBody extends Schema.Top,
  TSuccess extends Schema.Top,
  TErrors extends ReadonlyArray<AnyRouteError>,
> = P extends `/${infer First}/${infer Rest}`
  ? First extends `:${string}`
    ? ParsePath<
        `/${Rest}`,
        Method,
        TPath,
        TQuery,
        THeaders,
        TBody,
        TSuccess,
        TErrors
      >
    : {
        [K in First]: ParsePath<
          `/${Rest}`,
          Method,
          TPath,
          TQuery,
          THeaders,
          TBody,
          TSuccess,
          TErrors
        >;
      }
  : P extends `/${infer Last}`
    ? Last extends `:${string}`
      ? {
          [K in MethodName<Method>]: ClientMethod<
            P,
            TPath,
            TQuery,
            THeaders,
            TBody,
            TSuccess,
            TErrors
          >;
        }
      : {
          [K in Last]: {
            [M in MethodName<Method>]: ClientMethod<
              P,
              TPath,
              TQuery,
              THeaders,
              TBody,
              TSuccess,
              TErrors
            >;
          };
        }
    : {
        [K in MethodName<Method>]: ClientMethod<
          P,
          TPath,
          TQuery,
          THeaders,
          TBody,
          TSuccess,
          TErrors
        >;
      };

/**
 * Extract client type from a single route.
 */
type RouteToClient<R> = R extends {
  readonly method: infer M extends HttpMethod;
  readonly pattern: infer P extends PathInput;
  readonly config: RouteConfig<
    infer TPath,
    infer TQuery,
    infer THeaders,
    infer TBody,
    infer TSuccess,
    infer TErrors
  >;
}
  ? ParsePath<P, M, TPath, TQuery, THeaders, TBody, TSuccess, TErrors>
  : never;

/**
 * Deep merge for client types.
 */
type DeepMerge<T, U> = T extends object
  ? U extends object
    ? {
        [K in keyof T | keyof U]: K extends keyof T
          ? K extends keyof U
            ? DeepMerge<T[K], U[K]>
            : T[K]
          : K extends keyof U
            ? U[K]
            : never;
      }
    : U
  : U;

/**
 * Merge all routes into a single client type.
 */
type MergeRoutes<Routes> = Routes extends readonly [infer First, ...infer Rest]
  ? Rest extends readonly []
    ? RouteToClient<First>
    : DeepMerge<RouteToClient<First>, MergeRoutes<Rest>>
  : never;

/**
 * Extract routes array type from router.
 */
type RouterRoutes<R extends AnyRouter> = R extends { routes: infer Routes }
  ? Routes
  : never;

/**
 * Client type for a router.
 */
export type Client<R extends AnyRouter> = MergeRoutes<RouterRoutes<R>>;

/**
 * Client error for network/parsing failures.
 */
export class ClientError extends Schema.ErrorClass<{
  readonly _tag: "ClientError";
  readonly message: string;
  readonly cause: unknown;
}>("ClientError")({
  _tag: Schema.tag("ClientError"),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

/**
 * Client configuration.
 */
export interface ClientConfig {
  /** Base URL for API requests */
  readonly baseUrl: string;
  /** Optional fetch implementation (defaults to global fetch) */
  readonly fetch?: typeof globalThis.fetch;
  /** Optional default headers */
  readonly headers?: Record<string, string>;
}

/**
 * Build the URL with path parameters substituted.
 */
const buildUrl = (
  baseUrl: string,
  pattern: string,
  pathParams: Record<string, string> | undefined,
  queryParams: Record<string, unknown> | undefined,
): string => {
  let url = pattern;

  // Substitute path parameters
  if (pathParams) {
    for (const [key, value] of Object.entries(pathParams)) {
      url = url.replace(`:${key}`, encodeURIComponent(value));
    }
  }

  const fullUrl = new URL(url, baseUrl);

  // Add query parameters
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          for (const v of value) {
            fullUrl.searchParams.append(key, String(v));
          }
        } else {
          fullUrl.searchParams.set(key, String(value));
        }
      }
    }
  }

  return fullUrl.toString();
};

/**
 * Make a request to a route.
 */
const makeRequest = (
  config: ClientConfig,
  route: Routable,
  options: {
    path?: Record<string, string>;
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Effect.Effect<unknown, ClientError> =>
  Effect.gen(function* () {
    const fetchFn = config.fetch ?? globalThis.fetch;
    const url = buildUrl(
      config.baseUrl,
      route.pattern,
      options.path,
      options.query,
    );

    const requestHeaders = new Headers(config.headers);
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        requestHeaders.set(key, value);
      }
    }

    let requestBody: string | ReadableStream<Uint8Array> | undefined;
    if (options.body !== undefined) {
      if (Stream.isStream(options.body)) {
        requestBody = Stream.toReadableStream(
          options.body as Stream.Stream<Uint8Array>,
        );
      } else {
        requestHeaders.set("content-type", "application/json");
        requestBody = JSON.stringify(options.body);
      }
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetchFn(url, {
          method: route.method,
          headers: requestHeaders,
          body: requestBody,
        }),
      catch: (error) =>
        new ClientError({
          message: "Network request failed",
          cause: error,
        }),
    });

    if (!response.ok) {
      const errorBody = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () =>
          new ClientError({
            message: `Request failed with status ${response.status}: ${response.statusText}`,
          }),
      });

      // Try to reconstruct the error from the response
      const errorObj =
        typeof errorBody === "object" &&
        errorBody !== null &&
        "error" in errorBody
          ? (errorBody as { error: unknown }).error
          : errorBody;
      if (
        typeof errorObj === "object" &&
        errorObj !== null &&
        "_tag" in errorObj
      ) {
        return yield* Effect.fail(errorObj as ClientError);
      }

      return yield* new ClientError({
        message: `Request failed with status ${response.status}`,
        cause: errorBody,
      });
    }

    // Handle void responses
    if (
      response.status === 204 ||
      response.headers.get("content-length") === "0"
    ) {
      return undefined;
    }

    // Handle streaming responses
    const contentType = response.headers.get("content-type") ?? "";
    if (
      contentType.includes("application/octet-stream") ||
      contentType.includes("text/event-stream")
    ) {
      if (!response.body) {
        return Stream.empty;
      }
      return Stream.fromReadableStream({
        evaluate: () => response.body!,
        onError: () =>
          new ClientError({
            message: "Stream read error",
          }),
      });
    }

    // Parse JSON response
    return yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (error) =>
        new ClientError({
          message: "Failed to parse response",
          cause: error,
        }),
    });
  });

/**
 * Create a client method for a route.
 */
const createMethod = (
  config: ClientConfig,
  route: Routable,
): ((...args: unknown[]) => Effect.Effect<unknown, ClientError>) => {
  return (...args: unknown[]) => {
    const options = (args[0] ?? {}) as {
      path?: Record<string, string>;
      query?: Record<string, unknown>;
      headers?: Record<string, string>;
      body?: unknown;
    };
    return makeRequest(config, route, options);
  };
};

/**
 * Convert HTTP method to client method name.
 */
const methodToName = (method: HttpMethod): string => {
  switch (method) {
    case "GET":
      return "get";
    case "POST":
      return "create";
    case "PUT":
      return "update";
    case "PATCH":
      return "patch";
    case "DELETE":
      return "delete";
    case "HEAD":
      return "head";
    case "OPTIONS":
      return "options";
  }
};

/**
 * Parse path segments, skipping parameter segments.
 */
const parsePathSegments = (pattern: string): string[] => {
  return pattern
    .split("/")
    .filter((segment) => segment && !segment.startsWith(":"));
};

/**
 * Build the nested client structure from routes.
 */
const buildClientStructure = (
  config: ClientConfig,
  routes: ReadonlyArray<Routable>,
): Record<string, unknown> => {
  const client: Record<string, unknown> = {};

  for (const route of routes) {
    const segments = parsePathSegments(route.pattern);
    const methodName = methodToName(route.method);
    const method = createMethod(config, route);

    if (segments.length === 0) {
      // Root route like "/"
      client[methodName] = method;
    } else {
      // Navigate to the correct nested location
      let current = client;
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!;
        if (i === segments.length - 1) {
          // Last segment - add the method
          if (!current[segment]) {
            current[segment] = {};
          }
          (current[segment] as Record<string, unknown>)[methodName] = method;
        } else {
          // Intermediate segment - create nested object if needed
          if (!current[segment]) {
            current[segment] = {};
          }
          current = current[segment] as Record<string, unknown>;
        }
      }
    }
  }

  return client;
};

/**
 * Create a type-safe client from a router.
 *
 * @example
 * ```ts
 * const router = Router.make()
 *   .add(getUser)
 *   .add(createUser)
 *   .add(deleteUser);
 *
 * const client = Client.make(router, { baseUrl: "https://api.example.com" });
 *
 * // Type-safe usage:
 * const user = yield* client.users.get({ path: { id: "123" } });
 * const newUser = yield* client.users.create({ body: { name: "John" } });
 * yield* client.users.delete({ path: { id: "123" } });
 * ```
 */
export const make = <R extends AnyRouter>(
  router: R,
  config: ClientConfig,
): Client<R> => {
  return buildClientStructure(config, router.routes) as Client<R>;
};

/**
 * Create a promise-based client wrapper.
 */
export const makePromise = <R extends AnyRouter>(
  router: R,
  config: ClientConfig,
): PromiseClient<Client<R>> => {
  const effectClient = make(router, config);
  return wrapInPromise(effectClient) as PromiseClient<Client<R>>;
};

/**
 * Convert an Effect-returning function to a Promise-returning function.
 */
type PromisifyMethod<T> = T extends (
  ...args: infer A
) => Effect.Effect<infer R, infer _E>
  ? (...args: A) => Promise<R>
  : T extends object
    ? PromiseClient<T>
    : T;

/**
 * Promise-based client type.
 */
export type PromiseClient<T> = {
  [K in keyof T]: PromisifyMethod<T[K]>;
};

/**
 * Wrap Effect methods in Promise.
 */
const wrapInPromise = <T>(obj: T): PromiseClient<T> => {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj as object)) {
    if (typeof value === "function") {
      result[key] = (...args: unknown[]) =>
        Effect.runPromise(
          (value as (...args: unknown[]) => Effect.Effect<unknown>)(...args),
        );
    } else if (typeof value === "object" && value !== null) {
      result[key] = wrapInPromise(value);
    } else {
      result[key] = value;
    }
  }

  return result as PromiseClient<T>;
};
