import type { AnyGate, AnyGatedRoute, GatedRoute } from "./Gate.js";
import type { AnyRoute, Route } from "./Route.js";

/**
 * Union type for anything that can be added to a router.
 */
export type Routable = AnyRoute | AnyGatedRoute;

/**
 * Extract the operationId from a Route or GatedRoute type.
 */
type OperationIdOf<R> =
	R extends Route<infer Id, any, any, any, any>
		? Id
		: R extends GatedRoute<infer Id, any, any, any, any, any, any, any>
			? Id
			: never;

/**
 * Extract all operationIds from a Gate's routes.
 */
type GateOperationIds<G> = G extends AnyGate
	? OperationIdOf<G["routes"][number]>
	: never;

/**
 * Check if an operationId already exists in the Routes union.
 */
type HasOperationId<
	Routes,
	Id extends string,
> = Id extends OperationIdOf<Routes> ? true : false;

/**
 * Check if any operationId from a Gate conflicts with existing routes.
 */
type HasAnyOperationId<Routes, Ids extends string> = Ids extends any
	? HasOperationId<Routes, Ids> extends true
		? true
		: false
	: false;

/**
 * Error type shown when a duplicate operationId is detected.
 */
type DuplicateOperationIdError<Id extends string> = {
	readonly __error__: "DuplicateOperationId";
	readonly message: `Route with operationId "${Id}" already exists in the router`;
};

/**
 * Extract routes from a Gate.
 */
type ExtractGateRoutes<G> = G extends AnyGate ? G["routes"][number] : never;

/**
 * A Router composes multiple routes and preserves their types.
 */
export interface Router<Routes extends Routable = never> {
	readonly _tag: "Router";
	readonly routes: ReadonlyArray<Routes>;

	/**
	 * Add a route or gate to the router.
	 * Returns a new router with the route type(s) added to the Routes union.
	 *
	 * @typeError Fails at compile time if a route with the same operationId already exists.
	 */
	readonly add: {
		// Overload for single Route
		<R extends AnyRoute>(
			route: HasOperationId<Routes, OperationIdOf<R>> extends true
				? DuplicateOperationIdError<OperationIdOf<R>>
				: R,
		): Router<Routes | R>;

		// Overload for Gate (adds all routes from the gate)
		<G extends AnyGate>(
			gate: HasAnyOperationId<Routes, GateOperationIds<G>> extends true
				? DuplicateOperationIdError<GateOperationIds<G>>
				: G,
		): Router<Routes | ExtractGateRoutes<G>>;
	};
}

/**
 * Create a new empty Router.
 */
export const make = (): Router<never> => {
	const createRouter = <Routes extends Routable>(
		routes: ReadonlyArray<Routes>,
	): Router<Routes> => ({
		_tag: "Router",
		routes,
		add: (routeOrGate: any) => {
			// Check if it's a Gate
			if (routeOrGate._tag === "Gate") {
				// Add all routes from the gate
				return createRouter([...routes, ...routeOrGate.routes]) as any;
			}
			// It's a single route
			return createRouter([...routes, routeOrGate]) as any;
		},
	});

	return createRouter([]);
};
