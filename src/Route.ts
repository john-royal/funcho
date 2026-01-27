import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as StreamModule from "effect/Stream";
import * as Annotations from "./Annotations.js";
import { isStream, type Stream as StreamSchema } from "./Stream.js";

// Re-export annotation helpers and stream marker
export { contentType, headers, status, statusText } from "./Annotations.js";
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
  TPath extends Schema.Top | never = never,
  TQuery extends Schema.Top | never = never,
  THeaders extends Schema.Top | never = never,
  TBody extends Schema.Top | never = never,
  TSuccess extends Schema.Top = typeof Schema.Void,
  TErrors extends ReadonlyArray<Schema.Top> = readonly [],
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
  /**
   * Array of error schemas. These can be:
   * - Plain RouteError classes (e.g., `NotFoundError`)
   * - Transformed schemas via Schema.encodeTo() for custom response formats
   *
   * @example
   * ```ts
   * // Plain error
   * class NotFoundError extends Route.Error("NotFoundError", 404)({
   *   message: Schema.String,
   * }) {}
   *
   * // Transformed error with custom response shape
   * const CloudflareNotFoundError = NotFoundError.pipe(
   *   Schema.encodeTo(CloudflareErrorResponse, {
   *     encode: SchemaGetter.transform((e) => ({ success: false, errors: [...] })),
   *     decode: SchemaGetter.transform((r) => new NotFoundError({ message: r.errors[0].message })),
   *   }),
   * );
   *
   * // Plain text error
   * const TextUnauthorized = UnauthorizedError.pipe(
   *   Schema.encodeTo(Schema.String, { ... }),
   *   Route.contentType("text/plain"),
   * );
   *
   * // Use in route
   * errors: [NotFoundError, CloudflareNotFoundError, TextUnauthorized]
   * ```
   */
  readonly errors?: TErrors;
}

/**
 * Extract the type from a schema, returning undefined for never.
 * Uses direct property access (not conditional inference) to preserve type inference
 * when used with Effect.fn.
 */
type SchemaType<S extends Schema.Top | never> = S extends typeof StreamSchema
  ? StreamModule.Stream<Uint8Array>
  : [S] extends [never]
    ? undefined
    : S["Type"];

/**
 * Handler input - what the handler receives.
 */
export interface HandlerInput<
  TPath extends Schema.Top | never,
  TQuery extends Schema.Top | never,
  THeaders extends Schema.Top | never,
  TBody extends Schema.Top | never,
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
 * Union of error types from error schemas.
 * Extracts the Type from each schema in the errors array.
 */
type ErrorsUnion<TErrors extends ReadonlyArray<Schema.Top>> =
  TErrors extends readonly [] ? never : Schema.Schema.Type<TErrors[number]>;

/**
 * A Route definition.
 */
export interface Route<
  TMethod extends HttpMethod = HttpMethod,
  TPattern extends PathInput = PathInput,
  TPath extends Schema.Top | never = never,
  TQuery extends Schema.Top | never = never,
  THeaders extends Schema.Top | never = never,
  TBody extends Schema.Top | never = never,
  TSuccess extends Schema.Top = typeof Schema.Void,
  TErrors extends ReadonlyArray<Schema.Top> = readonly [],
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
  readonly handler: (input: {
    readonly path: SchemaType<TPath>;
    readonly query: SchemaType<TQuery>;
    readonly headers: SchemaType<THeaders>;
    readonly body: SchemaType<TBody>;
    readonly request: Request;
  }) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>;
}

/**
 * Any route type for collections.
 * This is a structural type that matches any Route, using a loose handler type.
 */
export interface AnyRoute {
  readonly _tag: "Route";
  readonly method: HttpMethod;
  readonly pattern: PathInput;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly config: RouteConfig<any, any, any, any, any, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly handler: (input: any) => Effect.Effect<any, any, any>;
}

/**
 * Create a route with the given method, pattern, config, and handler.
 *
 * Note: The handler input type is inlined rather than using HandlerInput<...>
 * because TypeScript's inference doesn't work well when flowing through
 * generic interface type parameters.
 */
export const make = <
  const TMethod extends HttpMethod,
  const TPattern extends PathInput,
  TPath extends Schema.Top | never = never,
  TQuery extends Schema.Top | never = never,
  THeaders extends Schema.Top | never = never,
  TBody extends Schema.Top | never = never,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<Schema.Top> = readonly [],
  R = never,
>(
  method: TMethod,
  pattern: TPattern,
  config: {
    readonly path?: TPath;
    readonly query?: TQuery;
    readonly headers?: THeaders;
    readonly body?: TBody;
    readonly success: TSuccess;
    readonly errors?: TErrors;
  },
  handler: (input: {
    readonly path: SchemaType<TPath>;
    readonly query: SchemaType<TQuery>;
    readonly headers: SchemaType<THeaders>;
    readonly body: SchemaType<TBody>;
    readonly request: Request;
  }) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
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
  TPath extends Schema.Top | never = never,
  TQuery extends Schema.Top | never = never,
  THeaders extends Schema.Top | never = never,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<Schema.Top> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: {
    readonly path?: TPath;
    readonly query?: TQuery;
    readonly headers?: THeaders;
    readonly success: TSuccess;
    readonly errors?: TErrors;
  },
  handler: (input: {
    readonly path: SchemaType<TPath>;
    readonly query: SchemaType<TQuery>;
    readonly headers: SchemaType<THeaders>;
    readonly body: undefined;
    readonly request: Request;
  }) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  "GET",
  TPattern,
  TPath,
  TQuery,
  THeaders,
  never,
  TSuccess,
  TErrors,
  R
> => make("GET", pattern, config, handler);

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
  TPath extends Schema.Top | never = never,
  TQuery extends Schema.Top | never = never,
  THeaders extends Schema.Top | never = never,
  TBody extends Schema.Top | never = never,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<Schema.Top> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: {
    readonly path?: TPath;
    readonly query?: TQuery;
    readonly headers?: THeaders;
    readonly body?: TBody;
    readonly success: TSuccess;
    readonly errors?: TErrors;
  },
  handler: (input: {
    readonly path: SchemaType<TPath>;
    readonly query: SchemaType<TQuery>;
    readonly headers: SchemaType<THeaders>;
    readonly body: SchemaType<TBody>;
    readonly request: Request;
  }) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
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
  TPath extends Schema.Top | never = never,
  TQuery extends Schema.Top | never = never,
  THeaders extends Schema.Top | never = never,
  TBody extends Schema.Top | never = never,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<Schema.Top> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: {
    readonly path?: TPath;
    readonly query?: TQuery;
    readonly headers?: THeaders;
    readonly body?: TBody;
    readonly success: TSuccess;
    readonly errors?: TErrors;
  },
  handler: (input: {
    readonly path: SchemaType<TPath>;
    readonly query: SchemaType<TQuery>;
    readonly headers: SchemaType<THeaders>;
    readonly body: SchemaType<TBody>;
    readonly request: Request;
  }) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
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
  TPath extends Schema.Top | never = never,
  TQuery extends Schema.Top | never = never,
  THeaders extends Schema.Top | never = never,
  TBody extends Schema.Top | never = never,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<Schema.Top> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: {
    readonly path?: TPath;
    readonly query?: TQuery;
    readonly headers?: THeaders;
    readonly body?: TBody;
    readonly success: TSuccess;
    readonly errors?: TErrors;
  },
  handler: (input: {
    readonly path: SchemaType<TPath>;
    readonly query: SchemaType<TQuery>;
    readonly headers: SchemaType<THeaders>;
    readonly body: SchemaType<TBody>;
    readonly request: Request;
  }) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
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
  TPath extends Schema.Top | never = never,
  TQuery extends Schema.Top | never = never,
  THeaders extends Schema.Top | never = never,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<Schema.Top> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: {
    readonly path?: TPath;
    readonly query?: TQuery;
    readonly headers?: THeaders;
    readonly success: TSuccess;
    readonly errors?: TErrors;
  },
  handler: (input: {
    readonly path: SchemaType<TPath>;
    readonly query: SchemaType<TQuery>;
    readonly headers: SchemaType<THeaders>;
    readonly body: undefined;
    readonly request: Request;
  }) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  "DELETE",
  TPattern,
  TPath,
  TQuery,
  THeaders,
  never,
  TSuccess,
  TErrors,
  R
> => make("DELETE", pattern, config, handler);

/**
 * Create an OPTIONS route.
 */
export const options = <
  const TPattern extends PathInput,
  TPath extends Schema.Top | never = never,
  TQuery extends Schema.Top | never = never,
  THeaders extends Schema.Top | never = never,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<Schema.Top> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: Omit<
    {
      readonly path?: TPath;
      readonly query?: TQuery;
      readonly headers?: THeaders;
      readonly success: TSuccess;
      readonly errors?: TErrors;
    },
    "body"
  >,
  handler: (input: {
    readonly path: SchemaType<TPath>;
    readonly query: SchemaType<TQuery>;
    readonly headers: SchemaType<THeaders>;
    readonly body: undefined;
    readonly request: Request;
  }) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  "OPTIONS",
  TPattern,
  TPath,
  TQuery,
  THeaders,
  never,
  TSuccess,
  TErrors,
  R
> => make("OPTIONS", pattern, config, handler);

/**
 * Create a HEAD route.
 */
export const head = <
  const TPattern extends PathInput,
  TPath extends Schema.Top | never = never,
  TQuery extends Schema.Top | never = never,
  THeaders extends Schema.Top | never = never,
  TSuccess extends Schema.Top = typeof Schema.Void,
  const TErrors extends ReadonlyArray<Schema.Top> = readonly [],
  R = never,
>(
  pattern: TPattern,
  config: {
    readonly path?: TPath;
    readonly query?: TQuery;
    readonly headers?: THeaders;
    readonly success: TSuccess;
    readonly errors?: TErrors;
  },
  handler: (input: {
    readonly path: SchemaType<TPath>;
    readonly query: SchemaType<TQuery>;
    readonly headers: SchemaType<THeaders>;
    readonly body: undefined;
    readonly request: Request;
  }) => Effect.Effect<HandlerReturn<TSuccess>, ErrorsUnion<TErrors>, R>,
): Route<
  "HEAD",
  TPattern,
  TPath,
  TQuery,
  THeaders,
  never,
  TSuccess,
  TErrors,
  R
> => make("HEAD", pattern, config, handler);

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
