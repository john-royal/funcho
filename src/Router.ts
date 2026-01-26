import type { AnyGate, AnyGatedRoute } from "./Gate.js";
import type { AnyRoute } from "./Route.js";

/**
 * A routable item - either a Route or a GatedRoute.
 */
export type Routable = AnyRoute | AnyGatedRoute;

/**
 * A Router composes routes and gated routes.
 */
export interface Router<Routes extends Routable = never> {
  readonly _tag: "Router";
  readonly routes: ReadonlyArray<Routes>;

  /**
   * Add a route to the router.
   */
  readonly add: <R extends AnyRoute | AnyGate>(
    routeOrGate: R,
  ) => Router<
    | Routes
    | (R extends AnyGate
        ? ExtractGateRoutes<R>
        : R extends AnyRoute
          ? R
          : never)
  >;

  /**
   * Add a prefix to all routes in this router.
   */
  readonly prefix: (prefix: string) => Router<Routes>;
}

/**
 * Extract all routes from a Gate.
 */
type ExtractGateRoutes<G extends AnyGate> = G extends {
  routes: ReadonlyArray<infer R>;
}
  ? R extends Routable
    ? R
    : never
  : never;

/**
 * Any router type.
 */
export type AnyRouter = Router<Routable>;

/**
 * Create a new empty Router.
 *
 * @example
 * ```ts
 * const router = Router.make()
 *   .add(getUser)
 *   .add(createUser)
 *   .add(AuthGate);
 *
 * const handler = Handler.toFetch(router);
 * ```
 */
export const make = (): Router<never> => {
  const createRouter = <Routes extends Routable>(
    routes: ReadonlyArray<Routes>,
    prefixValue: string = "",
  ): Router<Routes> =>
    ({
      _tag: "Router",
      routes,
      add: (routeOrGate: AnyRoute | AnyGate): Router<Routable> => {
        if (routeOrGate._tag === "Gate") {
          // Extract routes from gate
          const gate = routeOrGate as AnyGate;
          const gateRoutes = gate.routes.map((r) => ({
            ...r,
            pattern: prefixValue
              ? (`${prefixValue}${r.pattern}` as const)
              : r.pattern,
          }));
          return createRouter(
            [...routes, ...gateRoutes] as ReadonlyArray<Routable>,
            prefixValue,
          );
        }

        // Regular route
        const route = routeOrGate as AnyRoute;
        const prefixedRoute = prefixValue
          ? {
              ...route,
              pattern: `${prefixValue}${route.pattern}` as const,
            }
          : route;
        return createRouter(
          [...routes, prefixedRoute] as ReadonlyArray<Routable>,
          prefixValue,
        );
      },
      prefix: (prefix: string) => {
        const newPrefix = prefixValue + prefix;
        // Re-create router with new prefix applied to existing routes
        const prefixedRoutes = routes.map((r) => ({
          ...r,
          pattern: `${prefix}${r.pattern}` as const,
        }));
        return createRouter(prefixedRoutes as ReadonlyArray<Routes>, newPrefix);
      },
    }) as Router<Routes>;

  return createRouter([]);
};

/**
 * Check if a value is a Router.
 */
export const isRouter = (value: unknown): value is AnyRouter =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "Router";

/**
 * Check if a routable is a regular route (not a gated route).
 */
export const isRoute = (routable: Routable): routable is AnyRoute =>
  routable._tag === "Route";

/**
 * Check if a routable is a gated route.
 */
export const isGatedRoute = (routable: Routable): routable is AnyGatedRoute =>
  routable._tag === "GatedRoute";
