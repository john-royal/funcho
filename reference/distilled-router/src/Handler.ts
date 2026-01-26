import type { ExecutionContext } from "@cloudflare/workers-types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { AnyGatedRoute, GatedRoute } from "./Gate.js";
import { isGatedRoute } from "./Gate.js";
import * as Headers from "./Headers.js";
import type { AnyRoute, Route } from "./Route.js";
import type { Routable, Router } from "./Router.js";

/**
 * WinterCG-compliant fetch handler type.
 */
export type FetchHandler = (request: Request) => Promise<Response>;

/**
 * Extract the R (requirements) type from a Route or GatedRoute.
 * For GatedRoutes, includes gate requirements and route requirements,
 * but excludes the gate's context (since the handler provides it to the route).
 */
type RouteRequirements<T> =
	T extends Route<any, any, any, any, infer R>
		? R
		: T extends GatedRoute<
					any,
					any,
					any,
					any,
					any,
					infer TContext,
					infer RGate,
					infer RRoute
				>
			? RGate | Exclude<RRoute, TContext>
			: never;

/**
 * Extract combined requirements from all routes in a Router.
 * Excludes Headers since it's provided internally by the handler.
 */
export type RouterRequirements<R extends Router<any>> =
	R extends Router<infer Routes>
		? Exclude<RouteRequirements<Routes>, Headers.Headers>
		: never;

/**
 * Cloudflare Worker ExecutionContext service tag.
 */
export class WorkerCtx extends Context.Tag("@distilled-router/WorkerCtx")<
	WorkerCtx,
	ExecutionContext
>() {}

/**
 * Create a typed WorkerEnv tag for your specific Env type.
 *
 * @example
 * ```ts
 * interface Env {
 *   MY_SECRET: string;
 *   MY_KV: KVNamespace;
 * }
 *
 * const WorkerEnv = Handler.makeWorkerEnv<Env>();
 * ```
 */
export const makeWorkerEnv = <Env>() =>
	Context.GenericTag<Env>("@distilled-router/WorkerEnv");

// Helper to merge response headers with defaults
const mergeHeaders = (
	responseHeaders: Request["headers"],
	defaults: Record<string, string>,
): Request["headers"] => {
	const result = new Response().headers;
	// Add defaults first
	for (const [key, value] of Object.entries(defaults)) {
		result.set(key, value);
	}
	// Copy response headers (excluding Set-Cookie which needs special handling)
	responseHeaders.forEach((value, key) => {
		if (key.toLowerCase() !== "set-cookie") {
			result.set(key, value);
		}
	});
	// Handle Set-Cookie separately to preserve multiple values
	// (forEach combines them with ", " which is incorrect for cookies)
	if ("getSetCookie" in responseHeaders) {
		for (const cookie of (
			responseHeaders as { getSetCookie: () => string[] }
		).getSetCookie()) {
			result.append("Set-Cookie", cookie);
		}
	}
	return result;
};

/**
 * Internal: builds an Effect that handles a single request.
 * The Effect preserves the route's requirements (R) so they bubble up.
 */
const handleRequestEffect = (
	routeMap: Map<string, Routable>,
	request: Request,
): Effect.Effect<Response, never, any> => {
	return Effect.gen(function* () {
		// Only allow POST
		if (request.method !== "POST") {
			return new Response(
				JSON.stringify({
					error: { _tag: "MethodNotAllowed", method: request.method },
				}),
				{
					status: 405,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		// Parse URL to extract operationId
		const url = new URL(request.url);
		const pathParts = url.pathname.split("/").filter(Boolean);

		// Expect /operation/<operationId>
		if (pathParts.length !== 2 || pathParts[0] !== "operation") {
			return new Response(
				JSON.stringify({
					error: { _tag: "NotFound", path: url.pathname },
				}),
				{
					status: 404,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		const operationId = pathParts[1]!;
		const route = routeMap.get(operationId);

		if (!route) {
			return new Response(
				JSON.stringify({
					error: { _tag: "OperationNotFound", operationId },
				}),
				{
					status: 404,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		// Parse request body
		let rawInput: unknown;
		try {
			const text = yield* Effect.promise(() => request.text());
			rawInput = text ? JSON.parse(text) : undefined;
		} catch {
			return new Response(
				JSON.stringify({
					error: { _tag: "InvalidJson" },
				}),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		// Decode input against schema
		const decodeResult = Schema.decodeUnknownEither(route.traits.input)(
			rawInput,
		);

		if (decodeResult._tag === "Left") {
			return new Response(
				JSON.stringify({
					error: {
						_tag: "ValidationError",
						message: decodeResult.left.message,
					},
				}),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		const input = decodeResult.right;

		// Create Headers service for this request
		const { service: headersService, getResponseHeaders } = Headers.make(
			request.headers,
		);

		// Build the effect based on route type
		let effect: Effect.Effect<unknown, unknown, any>;

		if (isGatedRoute(route)) {
			// GatedRoute: run gate handler first, then route handler with context
			const gatedRoute = route as AnyGatedRoute;
			effect = Effect.gen(function* () {
				// Run gate handler to get context
				const context = yield* gatedRoute.gateHandler();
				// Provide context to route handler and run it
				return yield* Effect.provideService(
					gatedRoute.routeHandler(input),
					gatedRoute.Context,
					context,
				);
			});
		} else {
			// Regular Route: just run the handler
			effect = (route as AnyRoute).handler(input);
		}

		// Provide Headers service
		const headersLayer = Layer.succeed(Headers.Headers, headersService);
		effect = Effect.provide(effect, headersLayer);

		const result = yield* Effect.exit(effect);

		// Get response headers set by the handler
		const responseHeaders = getResponseHeaders();
		const defaultHeaders = { "Content-Type": "application/json" };

		if (result._tag === "Failure") {
			const cause = result.cause;
			if (cause._tag === "Fail") {
				const error = cause.error;
				return new Response(JSON.stringify({ error }), {
					status: 400,
					headers: mergeHeaders(responseHeaders, defaultHeaders),
				});
			}

			// Unexpected error
			return new Response(
				JSON.stringify({
					error: { _tag: "InternalServerError" },
				}),
				{
					status: 500,
					headers: mergeHeaders(responseHeaders, defaultHeaders),
				},
			);
		}

		// Encode output
		const output = result.value;
		return new Response(output === undefined ? null : JSON.stringify(output), {
			status: 200,
			headers: mergeHeaders(responseHeaders, defaultHeaders),
		});
	});
};

/**
 * Handler function type that returns an Effect requiring R.
 */
export type EffectFetchHandler<R> = (
	request: Request,
) => Effect.Effect<Response, never, R>;

/**
 * Convert a Router to an Effect-based fetch handler.
 *
 * The returned function takes a Request and returns an Effect<Response, never, R>
 * where R is the union of all requirements from the router's routes.
 * This allows requirements to bubble up to the call site where they can be provided.
 *
 * All routes are exposed as POST /operation/<operationId>
 * - Request body is parsed as JSON and decoded against the input schema
 * - Response is JSON-encoded output or error
 *
 * @example
 * ```ts
 * const WorkerEnv = Context.GenericTag<Env>("WorkerEnv");
 *
 * const myRoute = Route.make(
 *   { operationId: "myRoute" },
 *   Effect.fn(function* () {
 *     const env = yield* WorkerEnv;
 *     return { value: env.MY_SECRET };
 *   }),
 * );
 *
 * const app = Router.make().add(myRoute);
 * const handler = Handler.toFetchHandler(app);
 *
 * // Cloudflare Worker
 * export default {
 *   fetch(request: Request, env: Env, ctx: ExecutionContext) {
 *     const layer = Layer.mergeAll(
 *       Layer.succeed(WorkerEnv, env),
 *       Layer.succeed(Handler.WorkerCtx, ctx),
 *     );
 *     return Effect.runPromise(Effect.provide(handler(request), layer));
 *   },
 * } satisfies ExportedHandler<Env>;
 * ```
 */
export const toFetchHandler = <R extends Router<any>>(
	router: R,
): EffectFetchHandler<RouterRequirements<R>> => {
	const routeMap = new Map<string, Routable>();
	for (const route of router.routes) {
		routeMap.set(route.traits.operationId, route);
	}

	return (request: Request) => handleRequestEffect(routeMap, request);
};

/**
 * Convert a Router to a simple fetch handler.
 *
 * This is a convenience wrapper around toFetchHandler that runs the Effect
 * and returns a Promise. Use this for simple routers with no external requirements.
 *
 * For routers with requirements, use toFetchHandler instead and provide
 * the requirements when running the Effect.
 *
 * @example
 * ```ts
 * const app = Router.make().add(myRoute);
 * const handler = Handler.toFetch(app);
 *
 * // Use directly with fetch-compatible APIs
 * const response = await handler(request);
 * ```
 */
export const toFetch = <R extends Router<any>>(router: R): FetchHandler => {
	const effectHandler = toFetchHandler(router);
	return (request: Request) => Effect.runPromise(effectHandler(request));
};
