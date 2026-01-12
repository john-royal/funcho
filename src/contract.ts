import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import * as ServiceMap from "effect/ServiceMap";
import type {
  AnyResponseSchema,
  ResponseSchema,
  ResponseUnion,
} from "./schema.js";

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
  readonly success: AnyResponseSchema;
  readonly failure?: AnyResponseSchema;
}

type SameShape<Out, In extends Out> = In & {
  [K in Exclude<keyof In, keyof Out>]: never;
};

type StrictRouteDefinition<T extends RouteDefinition> = SameShape<
  RouteDefinition,
  T
>;

type StrictRoutes<T extends Partial<Record<HttpMethod, RouteDefinition>>> = {
  [M in keyof T]: T[M] extends RouteDefinition
    ? StrictRouteDefinition<T[M]>
    : never;
};

type StrictContract<
  T extends Record<string, Partial<Record<HttpMethod, RouteDefinition>>>,
> = {
  [P in keyof T]: StrictRoutes<T[P]>;
};

export type Contract = Record<
  string,
  Partial<Record<HttpMethod, RouteDefinition>>
>;

type SchemaRecord = Record<string, Schema.Top>;

type DecodeSchemaRecord<R extends SchemaRecord | undefined> =
  R extends SchemaRecord
    ? { readonly [K in keyof R]: R[K]["Type"] }
    : undefined;

type EncodeSchemaRecord<R extends Record<string, Schema.Top> | undefined> =
  R extends Record<string, Schema.Top>
    ? { readonly [K in keyof R]: R[K]["Type"] }
    : Record<string, never>;

type ExtractStatus<R extends AnyResponseSchema> =
  R extends ResponseSchema<infer _B, infer S, infer _H>
    ? S
    : R extends ResponseUnion<infer Responses>
      ? Responses[number] extends ResponseSchema<infer _B, infer S, infer _H>
        ? S
        : never
      : never;

type ExtractBody<R extends AnyResponseSchema> =
  R extends ResponseSchema<infer B, infer _S, infer _H>
    ? B["Type"]
    : R extends ResponseUnion<infer Responses>
      ? Responses[number] extends ResponseSchema<infer B, infer _S, infer _H>
        ? B["Type"]
        : never
      : never;

type ExtractHeaders<R extends AnyResponseSchema> =
  R extends ResponseSchema<infer _B, infer _S, infer H>
    ? EncodeSchemaRecord<H>
    : R extends ResponseUnion<infer Responses>
      ? Responses[number] extends ResponseSchema<infer _B, infer _S, infer H>
        ? EncodeSchemaRecord<H>
        : Record<string, never>
      : Record<string, never>;

type HasHeaders<R extends AnyResponseSchema> =
  R extends ResponseSchema<infer _B, infer _S, infer H>
    ? keyof H extends never
      ? false
      : true
    : R extends ResponseUnion<infer Responses>
      ? Responses[number] extends ResponseSchema<infer _B, infer _S, infer H>
        ? keyof H extends never
          ? false
          : true
        : false
      : false;

type IsSingleResponse<R extends AnyResponseSchema> = R extends ResponseSchema
  ? true
  : R extends ResponseUnion<infer Responses>
    ? Responses["length"] extends 1
      ? true
      : false
    : false;

export interface TypedResponse<
  Body = unknown,
  Status extends number = number,
  Headers extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly __brand: "TypedResponse";
  readonly body: Body;
  readonly status: Status;
  readonly headers: Headers;
}

type RespondOptions<
  R extends AnyResponseSchema,
  Single extends boolean,
  HasH extends boolean,
> = Single extends true
  ? HasH extends true
    ? { readonly headers: ExtractHeaders<R> }
    : { readonly headers?: ExtractHeaders<R> } | void
  : HasH extends true
    ? { readonly status: ExtractStatus<R>; readonly headers: ExtractHeaders<R> }
    : {
        readonly status: ExtractStatus<R>;
        readonly headers?: ExtractHeaders<R>;
      };

type RespondFn<R extends AnyResponseSchema> =
  IsSingleResponse<R> extends true
    ? HasHeaders<R> extends true
      ? (
          body: ExtractBody<R>,
          options: {
            readonly status?: ExtractStatus<R>;
            readonly headers: ExtractHeaders<R>;
          },
        ) => TypedResponse<ExtractBody<R>, ExtractStatus<R>, ExtractHeaders<R>>
      : (
          body: ExtractBody<R>,
          options?: {
            readonly status?: ExtractStatus<R>;
            readonly headers?: ExtractHeaders<R>;
          },
        ) => TypedResponse<ExtractBody<R>, ExtractStatus<R>, ExtractHeaders<R>>
    : HasHeaders<R> extends true
      ? (
          body: ExtractBody<R>,
          options: {
            readonly status: ExtractStatus<R>;
            readonly headers: ExtractHeaders<R>;
          },
        ) => TypedResponse<ExtractBody<R>, ExtractStatus<R>, ExtractHeaders<R>>
      : (
          body: ExtractBody<R>,
          options: {
            readonly status: ExtractStatus<R>;
            readonly headers?: ExtractHeaders<R>;
          },
        ) => TypedResponse<ExtractBody<R>, ExtractStatus<R>, ExtractHeaders<R>>;

type HandlerContext<Route extends RouteDefinition> = {
  readonly path: DecodeSchemaRecord<Route["path"]>;
  readonly query: DecodeSchemaRecord<Route["query"]>;
  readonly headers: DecodeSchemaRecord<Route["headers"]>;
  readonly body: Route["body"] extends Schema.Top
    ? Route["body"]["Type"]
    : undefined;
  readonly respond: RespondFn<Route["success"]>;
};

type HandlerEffect<Route extends RouteDefinition> = Effect.Effect<
  TypedResponse<
    ExtractBody<Route["success"]>,
    ExtractStatus<Route["success"]>,
    ExtractHeaders<Route["success"]>
  >,
  Route["failure"] extends AnyResponseSchema
    ? ExtractBody<Route["failure"]>
    : never
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
  contract: StrictContract<C>,
): ContractService<C> & { readonly Contract: C } => {
  const service = class extends ServiceMap.Service<
    ContractService<C>,
    Implementation<C>
  >()(`funcho/Contract/${Math.random().toString(36).slice(2)}`) {
    static readonly Contract = contract as C;
  };
  return service as ContractService<C> & { readonly Contract: C };
};

export const createTypedResponse = <
  Body,
  Status extends number,
  Headers extends Record<string, unknown>,
>(
  body: Body,
  status: Status,
  headers: Headers,
): TypedResponse<Body, Status, Headers> =>
  ({ __brand: "TypedResponse", body, status, headers }) as TypedResponse<
    Body,
    Status,
    Headers
  >;

export const isTypedResponse = (
  value: unknown,
): value is TypedResponse<unknown, number, Record<string, unknown>> =>
  value !== null &&
  typeof value === "object" &&
  "__brand" in value &&
  value.__brand === "TypedResponse";
