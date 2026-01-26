import type * as Schema from "effect/Schema";
import type { GatedRoute } from "./Gate.js";
import type { Route } from "./Route.js";
import type { Routable, Router } from "./Router.js";

/**
 * Extract the operationId from a Route or GatedRoute.
 */
type OperationIdOf<R> =
	R extends Route<infer Id, any, any, any, any>
		? Id
		: R extends GatedRoute<infer Id, any, any, any, any, any, any, any>
			? Id
			: never;

/**
 * Extract the input schema type from a Route or GatedRoute.
 */
type InputOf<R> =
	R extends Route<any, infer TInput, any, any, any>
		? Schema.Schema.Type<TInput>
		: R extends GatedRoute<any, infer TInput, any, any, any, any, any, any>
			? Schema.Schema.Type<TInput>
			: never;

/**
 * Extract the output schema type from a Route or GatedRoute.
 */
type OutputOf<R> =
	R extends Route<any, any, infer TOutput, any, any>
		? Schema.Schema.Type<TOutput>
		: R extends GatedRoute<any, any, infer TOutput, any, any, any, any, any>
			? Schema.Schema.Type<TOutput>
			: never;

/**
 * Extract errors union from a Route or GatedRoute.
 */
type ErrorsOf<R> =
	R extends Route<any, any, any, infer TErrors, any>
		? TErrors extends readonly Schema.Schema.AnyNoContext[]
			? Schema.Schema.Type<TErrors[number]>
			: never
		: R extends GatedRoute<
					any,
					any,
					any,
					infer TGateErrors,
					infer TRouteErrors,
					any,
					any,
					any
				>
			?
					| (TGateErrors extends readonly Schema.Schema.AnyNoContext[]
							? Schema.Schema.Type<TGateErrors[number]>
							: never)
					| (TRouteErrors extends readonly Schema.Schema.AnyNoContext[]
							? Schema.Schema.Type<TRouteErrors[number]>
							: never)
			: never;

/**
 * Find the route with a given operationId in a union of routes.
 */
type FindRoute<Routes, Id extends string> = Routes extends Routable
	? OperationIdOf<Routes> extends Id
		? Routes
		: never
	: never;

/**
 * Client result type - either success or error.
 */
export type ClientResult<TOutput, TError> =
	| { readonly ok: true; readonly value: TOutput }
	| { readonly ok: false; readonly error: TError };

/**
 * Client method signature for a route.
 */
type ClientMethod<Routes, Id extends string> = [FindRoute<Routes, Id>] extends [
	never,
]
	? never
	: InputOf<FindRoute<Routes, Id>> extends void
		? () => Promise<
				ClientResult<
					OutputOf<FindRoute<Routes, Id>>,
					ErrorsOf<FindRoute<Routes, Id>>
				>
			>
		: (
				input: InputOf<FindRoute<Routes, Id>>,
			) => Promise<
				ClientResult<
					OutputOf<FindRoute<Routes, Id>>,
					ErrorsOf<FindRoute<Routes, Id>>
				>
			>;

/**
 * Type-safe client generated from a Router.
 * Each operationId becomes a method on the client.
 */
export type Client<TRouter extends Router<Routable>> =
	TRouter extends Router<infer Routes>
		? {
				[Id in OperationIdOf<Routes>]: ClientMethod<Routes, Id>;
			}
		: never;

/**
 * Options for creating a client.
 */
export interface ClientOptions {
	/**
	 * Base URL of the API (e.g., "https://api.example.com")
	 */
	readonly baseUrl: string;

	/**
	 * Optional headers to include with every request.
	 */
	readonly headers?: Record<string, string>;

	/**
	 * Optional custom fetch implementation.
	 */
	readonly fetch?: Fetcher;
}

export type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

/**
 * Create a type-safe client from a Router type.
 *
 * @example
 * ```ts
 * const app = Router.make()
 *   .add(getUser)
 *   .add(createUser);
 *
 * const client = Client.make<typeof app>({
 *   baseUrl: "https://api.example.com",
 * });
 *
 * // Type-safe method calls
 * const result = await client.getUser({ id: "123" });
 * if (result.ok) {
 *   console.log(result.value.name);
 * } else {
 *   console.error(result.error._tag);
 * }
 * ```
 */
export const make = <TRouter extends Router<Routable>>(
	options: ClientOptions,
): Client<TRouter> => {
	const {
		baseUrl,
		headers: defaultHeaders = {},
		fetch: fetchImpl = fetch,
	} = options;

	// Normalize baseUrl (remove trailing slash)
	const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

	// Create a proxy that generates methods for each operationId
	return new Proxy({} as Client<TRouter>, {
		get(_, operationId: string) {
			return async (input?: unknown) => {
				const url = `${normalizedBaseUrl}/operation/${operationId}`;

				const body = input === undefined ? null : JSON.stringify(input);

				const response = await fetchImpl(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...defaultHeaders,
					},
					body,
				});

				const text = await response.text();
				const data = text ? JSON.parse(text) : undefined;

				if (response.ok) {
					return { ok: true, value: data };
				}

				// Error response has { error: ... } shape
				return { ok: false, error: data?.error };
			};
		},
	});
};
