/**
 * funcho - A middle-ground HTTP router for Effect 4
 *
 * @example
 * ```ts
 * import * as Route from "funcho/Route";
 * import * as Router from "funcho/Router";
 * import * as Handler from "funcho/Handler";
 * import * as Client from "funcho/Client";
 * import * as Schema from "effect/Schema";
 * import * as Effect from "effect/Effect";
 *
 * // Define an error
 * class NotFoundError extends Route.Error("NotFoundError", 404)({
 *   message: Schema.String,
 * }) {}
 *
 * // Define a route
 * const getUser = Route.get("/users/:id", {
 *   path: Schema.Struct({ id: Schema.String }),
 *   success: Schema.Struct({
 *     id: Schema.String,
 *     name: Schema.String,
 *   }).pipe(Route.status(200)),
 *   errors: [NotFoundError],
 * }, Effect.fnUntraced(function* ({ path }) {
 *   // Handler implementation
 *   return { id: path.id, name: "John" };
 * }));
 *
 * // Build router
 * const router = Router.make().add(getUser);
 *
 * // Create fetch handler (for servers)
 * export default { fetch: Handler.toFetch(router) };
 *
 * // Or create a client (for consumers)
 * const client = Client.make(router, { baseUrl: "https://api.example.com" });
 * const user = yield* client.users.get({ path: { id: "123" } });
 * ```
 *
 * @module
 */

// Core modules - namespace imports recommended
export * as Annotations from "./Annotations.js";
export type { Client as ClientType } from "./Client.js";
export * as Client from "./Client.js";
export type { AnyGate, AnyGatedRoute } from "./Gate.js";
export * as Gate from "./Gate.js";
export * as Handler from "./Handler.js";
export * as Headers from "./Headers.js";

// Re-export commonly used types
export type { AnyRoute, HttpMethod, PathInput, RouteConfig } from "./Route.js";
export * as Route from "./Route.js";
export type { AnyRouter, Routable } from "./Router.js";
export * as Router from "./Router.js";
