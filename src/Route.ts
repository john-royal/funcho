import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as StreamModule from "effect/Stream";
import * as Annotations from "./Annotations.js";
import type { AnyRouteError, InstanceOf } from "./Error.js";
import { isStream, type Stream as StreamSchema } from "./Stream.js";

// Re-export annotation helpers and stream marker
export { headers, status, statusText } from "./Annotations.js";
export { RouteError as Error } from "./Error.js";
export { Stream } from "./Stream.js";

/**
 * HTTP methods supported by the router.
 */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

/**
 * Path input must start with a forward slash.
 */
export type PathInput = `/${string}`;

/**
 * Route configuration.
 */
export interface RouteConfig<
  TPath extends Schema.Top = typeof Schema.Void,
  TQuery extends Schema.Top = typeof Schema.Void,
  THeaders extends Schema.Top = typeof Schema.Void,
  TBody extends Schema.Top = typeof Schema.Void,
  TSuccess extends Schema.Top = typeof Schema.Void,
  TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
> {
  /** Schema for path parameters (e.g., { id: Schema.String }) */
  readonly path?: TPath;
  /** Schema for query parameters */
  readonly query?: TQuery;
  /** Schema for request headers */
  readonly headers?: THeaders;
  /** Schema for request body (JSON, or Route.Stream for streaming) */
  readonly body?: TBody;
  /** Success response schema, annotated with Route.status() */
  readonly success: TSuccess;
  /** Array of error classes created with Route.Error() */
  readonly errors?: TErrors;
}

/**
 * Extract the type from a schema, handling void as undefined.
 */
type SchemaType<S> = S extends Schema.Schema<infer T> ? T : undefined;

/**
 * Handler input - what the handler receives.
 */
export interface HandlerInput<
  TPath extends Schema.Top,
  TQuery extends Schema.Top,
  THeaders extends Schema.Top,
  TBody extends Schema.Top,
> {
  /** Validated path parameters */
  readonly path: SchemaType<TPath>;
  /** Validated query parameters */
  readonly query: SchemaType<TQuery>;
  /** Validated request headers */
  readonly headers: SchemaType<THeaders>;
  /** Request body - either parsed JSON or Stream<Uint8Array> */
  readonly body: TBody extends typeof StreamSchema
    ? StreamModule.Stream<Uint8Array>
    : SchemaType<TBody>;
  /** Raw request for escape hatch */
  readonly request: Request;
}

// Note: HasHeaders and HasStatusText are complex to determine at type level
// since annotations are runtime-only. We rely on runtime checks in the handler.

/**
 * Extract the body type from a success schema.
 * If it's a Stream marker, return Stream<Uint8Array>.
 */
type SuccessBodyType<TSuccess extends Schema.Top> =
  TSuccess extends typeof StreamSchema
    ? StreamModule.Stream<Uint8Array>
    : Schema.Schema.Type<TSuccess>;

/**
 * Handler return type - simplified for single success status.
 * If headers/statusText are annotated, they must be provided.
 */
export type HandlerReturn<TSuccess extends Schema.Top> =
  // For now, simple: return body directly or with metadata
  | SuccessBodyType<TSuccess>
  | {
      readonly body: SuccessBodyType<TSuccess>;
      readonly headers?: Record<string, string>;
      readonly statusText?: string;
    };

/**
 * Union of error instances from error classes.
 */
type ErrorsUnion<TErrors extends ReadonlyArray<AnyRouteError>> =
  TErrors extends readonly [] ? never : InstanceOf<TErrors[number]>;

/**
 * A Route definition.
 */
export interface Route<
  TMethod extends HttpMethod = HttpMethod,
  TPattern extends PathInput = PathInput,
  TPath extends Schema.Top = typeof Schema.Void,
  TQuery extends Schema.Top = typeof Schema.Void,
  THeaders extends Schema.Top = typeof Schema.Void,
  TBody extends Schema.Top = typeof Schema.Void,
  TSuccess extends Schema.Top = typeof Schema.Void,
  TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
  R = never,
> {
  readonly _tag: "Route";
  readonly method: TMethod;
  readonly pattern: TPattern;
  readonly config: RouteConfig<
    TPath,
    TQuery,
    THeaders,
    TBody,
    TSuccess,
    TErrors
  >;
  readonly handler: (
    input: HandlerInput<TPath, TQuery, THeaders, TBody>,
  ) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>;
}

/**
 * Any route type for collections.
 */
export type AnyRoute = Route<
  HttpMethod,
  PathInput,
  Schema.Top,
  Schema.Top,
  Schema.Top,
  Schema.Top,
  Schema.Top,
  ReadonlyArray<AnyRouteError>,
  unknown
>;

/**
 * Create a route with the given method, pattern, config, and handler.
 */
export const make = <
  const TMethod extends HttpMethod,
  const TPattern extends PathInput,
  TPath extends Schema.Top = typeof Schema.Void,
  TQuery extends Schema.Top = typeof Schema.Void,
  THeaders extends Schema.Top = typeof Schema.Void,
  TBody extends Schema.Top = typeof Schema.Void,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
  R = never,
>(
  method: TMethod,
  pattern: TPattern,
  config: RouteConfig<TPath, TQuery, THeaders, TBody, TSuccess, TErrors>,
  handler: (
    input: HandlerInput<TPath, TQuery, THeaders, TBody>,
  ) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  TMethod,
  TPattern,
  TPath,
  TQuery,
  THeaders,
  TBody,
  TSuccess,
  TErrors,
  R
> => ({
  _tag: "Route",
  method,
  pattern,
  config,
  handler,
});

/**
 * Create a GET route.
 *
 * @example
 * ```ts
 * const getUser = Route.get("/users/:id", {
 *   path: Schema.Struct({ id: Schema.String }),
 *   success: UserSchema.pipe(Route.status(200)),
 *   errors: [NotFoundError],
 * }, Effect.fnUntraced(function* ({ path }) {
 *   const user = yield* UserRepo.findById(path.id);
 *   if (!user) return yield* new NotFoundError({ message: "User not found" });
 *   return user;
 * }));
 * ```
 */
export const get = <
  const TPattern extends PathInput,
  TPath extends Schema.Top = typeof Schema.Void,
  TQuery extends Schema.Top = typeof Schema.Void,
  THeaders extends Schema.Top = typeof Schema.Void,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: Omit<
    RouteConfig<TPath, TQuery, THeaders, typeof Schema.Void, TSuccess, TErrors>,
    "body"
  >,
  handler: (
    input: HandlerInput<TPath, TQuery, THeaders, typeof Schema.Void>,
  ) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  "GET",
  TPattern,
  TPath,
  TQuery,
  THeaders,
  typeof Schema.Void,
  TSuccess,
  TErrors,
  R
> =>
  make(
    "GET",
    pattern,
    config as RouteConfig<
      TPath,
      TQuery,
      THeaders,
      typeof Schema.Void,
      TSuccess,
      TErrors
    >,
    handler,
  );

/**
 * Create a POST route.
 *
 * @example
 * ```ts
 * const createUser = Route.post("/users", {
 *   body: Schema.Struct({ name: Schema.String, email: Schema.String }),
 *   success: UserSchema.pipe(Route.status(201)),
 * }, Effect.fnUntraced(function* ({ body }) {
 *   const user = yield* UserRepo.create(body);
 *   return user;
 * }));
 * ```
 */
export const post = <
  const TPattern extends PathInput,
  TPath extends Schema.Top = typeof Schema.Void,
  TQuery extends Schema.Top = typeof Schema.Void,
  THeaders extends Schema.Top = typeof Schema.Void,
  TBody extends Schema.Top = typeof Schema.Void,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: RouteConfig<TPath, TQuery, THeaders, TBody, TSuccess, TErrors>,
  handler: (
    input: HandlerInput<TPath, TQuery, THeaders, TBody>,
  ) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  "POST",
  TPattern,
  TPath,
  TQuery,
  THeaders,
  TBody,
  TSuccess,
  TErrors,
  R
> => make("POST", pattern, config, handler);

/**
 * Create a PUT route.
 */
export const put = <
  const TPattern extends PathInput,
  TPath extends Schema.Top = typeof Schema.Void,
  TQuery extends Schema.Top = typeof Schema.Void,
  THeaders extends Schema.Top = typeof Schema.Void,
  TBody extends Schema.Top = typeof Schema.Void,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: RouteConfig<TPath, TQuery, THeaders, TBody, TSuccess, TErrors>,
  handler: (
    input: HandlerInput<TPath, TQuery, THeaders, TBody>,
  ) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  "PUT",
  TPattern,
  TPath,
  TQuery,
  THeaders,
  TBody,
  TSuccess,
  TErrors,
  R
> => make("PUT", pattern, config, handler);

/**
 * Create a PATCH route.
 */
export const patch = <
  const TPattern extends PathInput,
  TPath extends Schema.Top = typeof Schema.Void,
  TQuery extends Schema.Top = typeof Schema.Void,
  THeaders extends Schema.Top = typeof Schema.Void,
  TBody extends Schema.Top = typeof Schema.Void,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: RouteConfig<TPath, TQuery, THeaders, TBody, TSuccess, TErrors>,
  handler: (
    input: HandlerInput<TPath, TQuery, THeaders, TBody>,
  ) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  "PATCH",
  TPattern,
  TPath,
  TQuery,
  THeaders,
  TBody,
  TSuccess,
  TErrors,
  R
> => make("PATCH", pattern, config, handler);

/**
 * Create a DELETE route.
 * Note: Named `del` because `delete` is a reserved word.
 */
export const del = <
  const TPattern extends PathInput,
  TPath extends Schema.Top = typeof Schema.Void,
  TQuery extends Schema.Top = typeof Schema.Void,
  THeaders extends Schema.Top = typeof Schema.Void,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: Omit<
    RouteConfig<TPath, TQuery, THeaders, typeof Schema.Void, TSuccess, TErrors>,
    "body"
  >,
  handler: (
    input: HandlerInput<TPath, TQuery, THeaders, typeof Schema.Void>,
  ) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  "DELETE",
  TPattern,
  TPath,
  TQuery,
  THeaders,
  typeof Schema.Void,
  TSuccess,
  TErrors,
  R
> =>
  make(
    "DELETE",
    pattern,
    config as RouteConfig<
      TPath,
      TQuery,
      THeaders,
      typeof Schema.Void,
      TSuccess,
      TErrors
    >,
    handler,
  );

/**
 * Create an OPTIONS route.
 */
export const options = <
  const TPattern extends PathInput,
  TPath extends Schema.Top = typeof Schema.Void,
  TQuery extends Schema.Top = typeof Schema.Void,
  THeaders extends Schema.Top = typeof Schema.Void,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: Omit<
    RouteConfig<TPath, TQuery, THeaders, typeof Schema.Void, TSuccess, TErrors>,
    "body"
  >,
  handler: (
    input: HandlerInput<TPath, TQuery, THeaders, typeof Schema.Void>,
  ) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  "OPTIONS",
  TPattern,
  TPath,
  TQuery,
  THeaders,
  typeof Schema.Void,
  TSuccess,
  TErrors,
  R
> =>
  make(
    "OPTIONS",
    pattern,
    config as RouteConfig<
      TPath,
      TQuery,
      THeaders,
      typeof Schema.Void,
      TSuccess,
      TErrors
    >,
    handler,
  );

/**
 * Create a HEAD route.
 */
export const head = <
  const TPattern extends PathInput,
  TPath extends Schema.Top = typeof Schema.Void,
  TQuery extends Schema.Top = typeof Schema.Void,
  THeaders extends Schema.Top = typeof Schema.Void,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: Omit<
    RouteConfig<TPath, TQuery, THeaders, typeof Schema.Void, TSuccess, TErrors>,
    "body"
  >,
  handler: (
    input: HandlerInput<TPath, TQuery, THeaders, typeof Schema.Void>,
  ) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  "HEAD",
  TPattern,
  TPath,
  TQuery,
  THeaders,
  typeof Schema.Void,
  TSuccess,
  TErrors,
  R
> =>
  make(
    "HEAD",
    pattern,
    config as RouteConfig<
      TPath,
      TQuery,
      THeaders,
      typeof Schema.Void,
      TSuccess,
      TErrors
    >,
    handler,
  );

/**
 * Check if a schema is the Stream marker.
 */
export { isStream };

/**
 * Get the status code from a success schema.
 */
export const getSuccessStatus = (schema: Schema.Top): number => {
  const status = Annotations.getStatus(schema);
  return status ?? 200;
};

/**
 * Get the headers schema from a success schema.
 */
export const getSuccessHeaders = Annotations.getHeaders;

/**
 * Get the status text schema from a success schema.
 */
export const getSuccessStatusText = Annotations.getStatusText;
