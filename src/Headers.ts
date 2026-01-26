import * as Effect from "effect/Effect";
import * as ServiceMap from "effect/ServiceMap";

/**
 * The shape of the Headers service.
 */
export interface HeadersService {
  /**
   * Get a single request header value by name.
   * Returns undefined if the header is not present.
   */
  readonly get: (name: string) => Effect.Effect<string | undefined>;

  /**
   * Get all request headers.
   */
  readonly getAll: Effect.Effect<globalThis.Headers>;

  /**
   * Set a response header. Overwrites any existing value.
   */
  readonly set: (name: string, value: string) => Effect.Effect<void>;

  /**
   * Append a value to a response header.
   * If the header already exists, the new value is appended (useful for Set-Cookie).
   */
  readonly append: (name: string, value: string) => Effect.Effect<void>;
}

/**
 * Service for accessing request headers and setting response headers.
 *
 * This service is provided automatically to route handlers by the request handling
 * infrastructure. It allows handlers to read incoming request headers and set
 * headers on the outgoing response.
 *
 * @example
 * ```ts
 * const handler = Effect.fnUntraced(function* () {
 *   // Read a request header
 *   const auth = yield* Headers.get("authorization");
 *
 *   // Set a response header
 *   yield* Headers.set("x-request-id", crypto.randomUUID());
 *
 *   return { data: "..." };
 * });
 * ```
 */
export class Headers extends ServiceMap.Service<Headers, HeadersService>()(
  "funcho/Headers",
) {}

/**
 * Get a request header by name.
 */
export const get = (
  name: string,
): Effect.Effect<string | undefined, never, Headers> =>
  Headers.use((h) => h.get(name));

/**
 * Get all request headers.
 */
export const getAll: Effect.Effect<globalThis.Headers, never, Headers> =
  Headers.use((h) => h.getAll);

/**
 * Set a response header.
 */
export const set = (
  name: string,
  value: string,
): Effect.Effect<void, never, Headers> =>
  Headers.use((h) => h.set(name, value));

/**
 * Append a value to a response header.
 */
export const append = (
  name: string,
  value: string,
): Effect.Effect<void, never, Headers> =>
  Headers.use((h) => h.append(name, value));

/**
 * Create a Headers service instance from request headers.
 * Returns the service implementation and a function to retrieve the response headers.
 */
export const make = (
  requestHeaders: globalThis.Headers,
): {
  service: HeadersService;
  getResponseHeaders: () => globalThis.Headers;
} => {
  const responseHeaders = new globalThis.Headers();

  const service: HeadersService = {
    get: (name: string) =>
      Effect.succeed(requestHeaders.get(name) ?? undefined),
    getAll: Effect.succeed(requestHeaders),
    set: (name: string, value: string) =>
      Effect.sync(() => {
        responseHeaders.set(name, value);
      }),
    append: (name: string, value: string) =>
      Effect.sync(() => {
        responseHeaders.append(name, value);
      }),
  };

  return {
    service,
    getResponseHeaders: () => responseHeaders,
  };
};
