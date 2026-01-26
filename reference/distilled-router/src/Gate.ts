import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type { Route } from "./Route.js";

// Counter for generating unique gate IDs (avoids crypto.randomUUID() in global scope)
let gateIdCounter = 0;

/**
 * Gate traits - only allows errors (no input/output/operationId).
 * These errors are merged with each route's errors.
 */
export interface GateTraits<
	TErrors extends
		ReadonlyArray<Schema.Schema.AnyNoContext> = ReadonlyArray<Schema.Schema.AnyNoContext>,
> {
	readonly errors?: TErrors;
}

/**
 * Converts an array of error schemas to a union type.
 */
type ErrorsToUnion<T extends ReadonlyArray<Schema.Schema.AnyNoContext>> =
	T extends readonly [] ? never : Schema.Schema.Type<T[number]>;

/**
 * A Gate wraps routes with shared behavior (like auth) and merged traits.
 * The gate handler runs before each route and can provide context.
 */
export interface Gate<
	TErrors extends ReadonlyArray<Schema.Schema.AnyNoContext> = readonly [],
	TContext = void,
	R = never,
	Routes extends AnyGatedRoute = never,
> {
	readonly _tag: "Gate";
	readonly traits: {
		readonly errors: TErrors;
	};
	readonly handler: () => Effect.Effect<TContext, ErrorsToUnion<TErrors>, R>;
	readonly routes: ReadonlyArray<Routes>;
	readonly Context: Context.Tag<TContext, TContext>;

	/**
	 * Add a route to this gate.
	 * The route will have the gate's errors merged with its own,
	 * and the gate's handler will run before the route handler.
	 */
	readonly add: <
		TOperationId extends string,
		TInput extends Schema.Schema.AnyNoContext,
		TOutput extends Schema.Schema.AnyNoContext,
		TRouteErrors extends ReadonlyArray<Schema.Schema.AnyNoContext>,
		RRoute,
	>(
		route: Route<TOperationId, TInput, TOutput, TRouteErrors, RRoute>,
	) => Gate<
		TErrors,
		TContext,
		R,
		| Routes
		| GatedRoute<
				TOperationId,
				TInput,
				TOutput,
				TErrors,
				TRouteErrors,
				TContext,
				R,
				RRoute
		  >
	>;
}

/**
 * A route that has been added to a gate.
 * Combines the gate's errors with the route's errors.
 */
export interface GatedRoute<
	TOperationId extends string,
	TInput extends Schema.Schema.AnyNoContext,
	TOutput extends Schema.Schema.AnyNoContext,
	TGateErrors extends ReadonlyArray<Schema.Schema.AnyNoContext>,
	TRouteErrors extends ReadonlyArray<Schema.Schema.AnyNoContext>,
	TContext,
	RGate,
	RRoute,
> {
	readonly _tag: "GatedRoute";
	readonly traits: {
		readonly operationId: TOperationId;
		readonly input: TInput;
		readonly output: TOutput;
		readonly errors: readonly [...TGateErrors, ...TRouteErrors];
	};
	readonly gateHandler: () => Effect.Effect<
		TContext,
		ErrorsToUnion<TGateErrors>,
		RGate
	>;
	readonly routeHandler: (
		input: Schema.Schema.Type<TInput>,
	) => Effect.Effect<
		Schema.Schema.Type<TOutput>,
		ErrorsToUnion<TRouteErrors>,
		RRoute
	>;
	readonly Context: Context.Tag<TContext, TContext>;
}

export type AnyGate = Gate<any, any, any, AnyGatedRoute>;

export type AnyGatedRoute = GatedRoute<
	string,
	any,
	any,
	any,
	any,
	any,
	any,
	any
>;

/**
 * Create a new Gate with the given traits and handler.
 *
 * @example
 * ```ts
 * // Define an auth gate
 * const AuthGate = Gate.make(
 *   { errors: [UnauthorizedError] },
 *   Effect.fn(function* () {
 *     const token = yield* Headers.get("Authorization");
 *     if (!token) return yield* new UnauthorizedError({});
 *     const user = yield* verifyToken(token);
 *     return { user };
 *   })
 * );
 *
 * // Add routes to the gate
 * const authedRoutes = AuthGate
 *   .add(getProfileRoute)
 *   .add(updateProfileRoute);
 *
 * // In routes, access the gate's context
 * const getProfile = Route.make(
 *   { operationId: "getProfile" },
 *   Effect.fn(function* () {
 *     const { user } = yield* AuthGate.Context;
 *     return user.profile;
 *   })
 * );
 * ```
 */
export const make = <
	const TErrors extends ReadonlyArray<Schema.Schema.AnyNoContext> = readonly [],
	TContext = void,
	R = never,
>(
	traits: {
		readonly errors?: TErrors;
	},
	handler: () => Effect.Effect<TContext, ErrorsToUnion<TErrors>, R>,
): Gate<TErrors, [TContext] extends [never] ? void : TContext, R, never> => {
	// Create a unique context tag for this gate (using counter to avoid crypto in global scope)
	const gateId = gateIdCounter++;
	const GateContext = Context.GenericTag<TContext>(
		`@distilled-router/Gate/${gateId}`,
	);

	const createGate = <Routes extends AnyGatedRoute>(
		routes: ReadonlyArray<Routes>,
	): Gate<TErrors, TContext, R, Routes> => ({
		_tag: "Gate",
		traits: {
			errors: (traits.errors ?? []) as unknown as TErrors,
		},
		handler,
		routes,
		Context: GateContext,
		add: (route) => {
			const gatedRoute = {
				_tag: "GatedRoute" as const,
				traits: {
					operationId: route.traits.operationId,
					input: route.traits.input,
					output: route.traits.output,
					errors: [
						...((traits.errors ?? []) as readonly Schema.Schema.AnyNoContext[]),
						...(route.traits.errors as readonly Schema.Schema.AnyNoContext[]),
					],
				},
				gateHandler: handler,
				routeHandler: route.handler,
				Context: GateContext,
			};
			return createGate([...routes, gatedRoute as any]) as any;
		},
	});

	return createGate([]) as any;
};

/**
 * Check if a value is a GatedRoute.
 */
export const isGatedRoute = (value: unknown): value is AnyGatedRoute =>
	typeof value === "object" &&
	value !== null &&
	"_tag" in value &&
	value._tag === "GatedRoute";
