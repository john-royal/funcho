import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import * as ServiceMap from "effect/ServiceMap";
import type { FunchoResponse, ResponseBody } from "./response.js";

export type HttpMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "head"
  | "options";

export interface RouteDefinition {
  readonly description?: string;
  readonly path?: Record<string, Schema.Top>;
  readonly query?: Record<string, Schema.Top>;
  readonly headers?: Record<string, Schema.Top>;
  readonly body?: Schema.Top;
  readonly success: Schema.Top;
  readonly failure?: Schema.Top;
  readonly responseHeaders?: Record<string, Schema.Top>;
}

export type Contract = Record<
  string,
  Partial<Record<HttpMethod, RouteDefinition>>
>;

type SchemaRecord = Record<string, Schema.Top>;

type DecodeSchemaRecord<R extends SchemaRecord | undefined> =
  R extends SchemaRecord
    ? { readonly [K in keyof R]: R[K]["Type"] }
    : undefined;

type HandlerContext<Route extends RouteDefinition> = {
  readonly path: DecodeSchemaRecord<Route["path"]>;
  readonly query: DecodeSchemaRecord<Route["query"]>;
  readonly headers: DecodeSchemaRecord<Route["headers"]>;
  readonly body: Route["body"] extends Schema.Top
    ? Route["body"]["Type"]
    : undefined;
};

type HandlerResult<T> = T | FunchoResponse<T> | ResponseBody;

type HandlerEffect<Route extends RouteDefinition> = Effect.Effect<
  HandlerResult<Route["success"]["Type"]>,
  Route["failure"] extends Schema.Top ? Route["failure"]["Type"] : never
>;

type RouteHandler<Route extends RouteDefinition> = (
  context: HandlerContext<Route>,
) => HandlerEffect<Route>;

type RouteImplementation<
  Routes extends Partial<Record<HttpMethod, RouteDefinition>>,
> = {
  readonly [M in keyof Routes]: Routes[M] extends RouteDefinition
    ? RouteHandler<Routes[M]>
    : never;
};

export type Implementation<C extends Contract> = {
  readonly [Path in keyof C]: RouteImplementation<C[Path]>;
};

export interface ContractService<C extends Contract>
  extends ServiceMap.Service<ContractService<C>, Implementation<C>> {}

export const defineContract = <const C extends Contract>(
  contract: C,
): ContractService<C> & { readonly Contract: C } => {
  const service = class extends ServiceMap.Service<
    ContractService<C>,
    Implementation<C>
  >()(`funcho/Contract/${Math.random().toString(36).slice(2)}`) {
    static readonly Contract = contract;
  };
  return service as ContractService<C> & { readonly Contract: C };
};
