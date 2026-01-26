import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * Headers service interface for getting request headers and setting response headers.
 */
export interface HeadersService {
	/**
	 * Get a request header value by name (case-insensitive).
	 * Returns undefined if the header is not present.
	 */
	readonly get: (name: string) => string | undefined;

	/**
	 * Get all request headers as a Request["headers"] object.
	 */
	readonly getAll: () => Request["headers"];

	/**
	 * Set a response header. Can be called multiple times for different headers.
	 * Setting the same header multiple times will overwrite the previous value.
	 */
	readonly set: (name: string, value: string) => void;

	/**
	 * Append a response header value. Unlike set, this adds to existing values.
	 */
	readonly append: (name: string, value: string) => void;

	/**
	 * Delete a response header.
	 */
	readonly delete: (name: string) => void;
}

/**
 * Headers service tag for accessing request/response headers in route handlers.
 *
 * @example
 * ```ts
 * import * as Headers from "distilled-router/Headers";
 *
 * const myRoute = Route.make(
 *   { operationId: "myRoute" },
 *   Effect.fn(function* () {
 *     const headers = yield* Headers.Headers;
 *
 *     // Read request headers
 *     const authToken = headers.get("Authorization");
 *     const contentType = headers.get("Content-Type");
 *
 *     // Set response headers
 *     headers.set("X-Request-Id", "abc123");
 *     headers.set("Cache-Control", "max-age=3600");
 *   }),
 * );
 * ```
 */
export class Headers extends Context.Tag("@distilled-router/Headers")<
	Headers,
	HeadersService
>() {}

/**
 * Create a Headers service instance from a request.
 * Used internally by the handler.
 */
export const make = (
	requestHeaders: Request["headers"],
): {
	service: HeadersService;
	getResponseHeaders: () => Request["headers"];
} => {
	// Use the Headers constructor from the Response class
	const responseHeaders = new Response().headers;

	const service: HeadersService = {
		get: (name: string) => requestHeaders.get(name) ?? undefined,
		getAll: () => requestHeaders,
		set: (name: string, value: string) => responseHeaders.set(name, value),
		append: (name: string, value: string) =>
			responseHeaders.append(name, value),
		delete: (name: string) => responseHeaders.delete(name),
	};

	return {
		service,
		getResponseHeaders: () => responseHeaders,
	};
};

/**
 * Effect accessor for getting a request header.
 *
 * @example
 * ```ts
 * const token = yield* Headers.get("Authorization");
 * ```
 */
export const get = (
	name: string,
): Effect.Effect<string | undefined, never, Headers> =>
	Effect.map(Headers, (h) => h.get(name));

/**
 * Effect accessor for getting all request headers.
 *
 * @example
 * ```ts
 * const allHeaders = yield* Headers.getAll;
 * ```
 */
export const getAll: Effect.Effect<Request["headers"], never, Headers> =
	Effect.map(Headers, (h) => h.getAll());

/**
 * Effect accessor for setting a response header.
 *
 * @example
 * ```ts
 * yield* Headers.set("X-Request-Id", requestId);
 * ```
 */
export const set = (
	name: string,
	value: string,
): Effect.Effect<void, never, Headers> =>
	Effect.map(Headers, (h) => h.set(name, value));

/**
 * Effect accessor for appending a response header.
 *
 * @example
 * ```ts
 * yield* Headers.append("Set-Cookie", "session=abc");
 * yield* Headers.append("Set-Cookie", "theme=dark");
 * ```
 */
export const append = (
	name: string,
	value: string,
): Effect.Effect<void, never, Headers> =>
	Effect.map(Headers, (h) => h.append(name, value));
