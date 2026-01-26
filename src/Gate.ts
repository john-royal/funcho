import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import * as ServiceMap from "effect/ServiceMap";
import type { AnyRouteError, InstanceOf } from "./Error.js";
import type {
  AnyRoute,
  HandlerInput,
  HandlerReturn,
  HttpMethod,
  PathInput,
  Route,
  RouteConfig,
} from "./Route.js";

/**
 * Counter for generating unique gate IDs.
 */
let gateIdCounter = 0;

/**
 * Union of error instances from error classes.
 */
type ErrorsUnion<TErrors extends ReadonlyArray<AnyRouteError>> =
  TErrors extends readonly [] ? never : InstanceOf<TErrors[number]>;

/**
 * A Gate wraps routes with shared behavior (like auth) and merged error types.
 * The gate handler runs before each route and can provide typed context.
 */
export interface Gate<
  TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
  TContext = void,
  R = never,
  Routes extends AnyGatedRoute = never,
> {
  readonly _tag: "Gate";
  readonly errors: TErrors;
  readonly handler: () => Effect.Effect<TContext, ErrorsUnion<TErrors>, R>;
  readonly routes: ReadonlyArray<Routes>;
  readonly Context: ServiceMap.Service<TContext, TContext>;

  /**
   * Add a route to this gate.
   * The route will have the gate's errors merged with its own,
   * and the gate's handler will run before the route handler.
   */
  readonly add: <R2 extends AnyRoute>(
    route: R2,
  ) => Gate<
    TErrors,
    TContext,
    R,
    Routes | GatedRouteFrom<R2, TErrors, TContext, R>
  >;
}

/**
 * Helper type to create a GatedRoute from a Route.
 */
type GatedRouteFrom<
  R2 extends AnyRoute,
  TErrors extends ReadonlyArray<AnyRouteError>,
  TContext,
  R,
> = R2 extends Route<
  infer TMethod,
  infer TPattern,
  infer TPath,
  infer TQuery,
  infer THeaders,
  infer TBody,
  infer TSuccess,
  infer TRouteErrors,
  infer RRoute
>
  ? GatedRoute<
      TMethod,
      TPattern,
      TPath,
      TQuery,
      THeaders,
      TBody,
      TSuccess,
      TErrors,
      TRouteErrors,
      TContext,
      R,
      RRoute
    >
  : never;

/**
 * A route that has been added to a gate.
 * Combines the gate's errors with the route's errors.
 */
export interface GatedRoute<
  TMethod extends HttpMethod,
  TPattern extends PathInput,
  TPath extends Schema.Top,
  TQuery extends Schema.Top,
  THeaders extends Schema.Top,
  TBody extends Schema.Top,
  TSuccess extends Schema.Top,
  TGateErrors extends ReadonlyArray<AnyRouteError>,
  TRouteErrors extends ReadonlyArray<AnyRouteError>,
  TContext,
  RGate,
  RRoute,
> {
  readonly _tag: "GatedRoute";
  readonly method: TMethod;
  readonly pattern: TPattern;
  readonly config: RouteConfig<
    TPath,
    TQuery,
    THeaders,
    TBody,
    TSuccess,
    readonly [...TGateErrors, ...TRouteErrors]
  >;
  readonly gateHandler: () => Effect.Effect<
    TContext,
    ErrorsUnion<TGateErrors>,
    RGate
  >;
  readonly routeHandler: (
    input: HandlerInput<TPath, TQuery, THeaders, TBody>,
  ) => Effect.Effect<
    HandlerReturn<TSuccess>,
    ErrorsUnion<TRouteErrors>,
    RRoute
  >;
  readonly Context: ServiceMap.Service<TContext, TContext>;
}

/**
 * Any gate type for collections.
 */
export type AnyGate = Gate<
  ReadonlyArray<AnyRouteError>,
  unknown,
  unknown,
  AnyGatedRoute
>;

/**
 * Any gated route type for collections.
 */
export type AnyGatedRoute = GatedRoute<
  HttpMethod,
  PathInput,
  Schema.Top,
  Schema.Top,
  Schema.Top,
  Schema.Top,
  Schema.Top,
  ReadonlyArray<AnyRouteError>,
  ReadonlyArray<AnyRouteError>,
  any,
  any,
  any
>;

/**
 * Create a new Gate with the given errors and handler.
 *
 * @example
 * ```ts
 * const AuthGate = Gate.make({
 *   errors: [UnauthorizedError],
 * }, Effect.fnUntraced(function* () {
 *   const token = yield* Headers.get("authorization");
 *   if (!token) {
 *     return yield* new UnauthorizedError({ message: "Missing token" });
 *   }
 *   const user = yield* TokenService.verify(token);
 *   return { user };
 * }));
 *
 * // Routes can access gate context
 * const getProfile = AuthGate.add(
 *   Route.get("/profile", {
 *     success: UserSchema.pipe(Route.status(200)),
 *   }, Effect.fnUntraced(function* () {
 *     const { user } = yield* AuthGate.Context;
 *     return user;
 *   }))
 * );
 * ```
 */
export const make = <
  const TErrors extends ReadonlyArray<AnyRouteError> = readonly [],
  TContext = void,
  R = never,
>(
  config: {
    readonly errors?: TErrors;
  },
  handler: () => Effect.Effect<TContext, ErrorsUnion<TErrors>, R>,
): Gate<TErrors, [TContext] extends [never] ? void : TContext, R, never> => {
  // Create a unique context service for this gate
  const gateId = gateIdCounter++;
  const GateContext = ServiceMap.Service<TContext>(`funcho/Gate/${gateId}`);

  const createGate = (
    routes: ReadonlyArray<AnyGatedRoute>,
  ): Gate<TErrors, TContext, R, any> =>
    ({
      _tag: "Gate",
      errors: (config.errors ?? []) as TErrors,
      handler,
      routes,
      Context: GateContext as unknown as ServiceMap.Service<TContext, TContext>,
      add: (route: AnyRoute) => {
        const gatedRoute: AnyGatedRoute = {
          _tag: "GatedRoute",
          method: route.method,
          pattern: route.pattern,
          config: {
            ...route.config,
            errors: [
              ...((config.errors ?? []) as ReadonlyArray<AnyRouteError>),
              ...((route.config.errors ?? []) as ReadonlyArray<AnyRouteError>),
            ],
          },
          gateHandler: handler as () => Effect.Effect<
            unknown,
            unknown,
            unknown
          >,
          routeHandler: route.handler as (
            input: HandlerInput<Schema.Top, Schema.Top, Schema.Top, Schema.Top>,
          ) => Effect.Effect<unknown, unknown, unknown>,
          Context: GateContext as unknown as ServiceMap.Service<
            unknown,
            unknown
          >,
        };
        return createGate([...routes, gatedRoute]);
      },
    }) as Gate<TErrors, TContext, R, any>;

  return createGate([]) as Gate<
    TErrors,
    [TContext] extends [never] ? void : TContext,
    R,
    never
  >;
};

/**
 * Check if a value is a GatedRoute.
 */
export const isGatedRoute = (value: unknown): value is AnyGatedRoute =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "GatedRoute";
