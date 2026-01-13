import * as Schema from "effect/Schema";

export const ResponseSchemaSymbol: unique symbol = Symbol.for(
  "funcho/ResponseSchema",
);

export const ResponseUnionSymbol: unique symbol = Symbol.for(
  "funcho/ResponseUnion",
);

export interface ResponseSchema<
  Body extends Schema.Top = Schema.Top,
  Status extends number = number,
  Headers extends Record<string, Schema.Top> = Record<string, Schema.Top>,
> {
  readonly [ResponseSchemaSymbol]: true;
  readonly body: Body;
  readonly status: Status;
  readonly headers: Headers;
}

export interface ResponseUnion<
  Responses extends
    ReadonlyArray<ResponseSchema> = ReadonlyArray<ResponseSchema>,
> {
  readonly [ResponseUnionSymbol]: true;
  readonly responses: Responses;
}

export type AnyResponseSchema = ResponseSchema | ResponseUnion;

export const isResponseSchema = (value: unknown): value is ResponseSchema =>
  value !== null &&
  typeof value === "object" &&
  ResponseSchemaSymbol in value &&
  value[ResponseSchemaSymbol] === true;

export const isResponseUnion = (value: unknown): value is ResponseUnion =>
  value !== null &&
  typeof value === "object" &&
  ResponseUnionSymbol in value &&
  value[ResponseUnionSymbol] === true;

interface ResponseOptions<
  Status extends number,
  Headers extends Record<string, Schema.Top>,
> {
  readonly status?: Status;
  readonly headers?: Headers;
}

type ResponseFn = {
  <Body extends Schema.Top>(body: Body): ResponseSchema<Body, 200, {}>;

  <Body extends Schema.Top, Status extends number>(
    body: Body,
    options: { readonly status: Status },
  ): ResponseSchema<Body, Status, {}>;

  <Body extends Schema.Top, Headers extends Record<string, Schema.Top>>(
    body: Body,
    options: { readonly headers: Headers },
  ): ResponseSchema<Body, 200, Headers>;

  <
    Body extends Schema.Top,
    Status extends number,
    Headers extends Record<string, Schema.Top>,
  >(
    body: Body,
    options: { readonly status: Status; readonly headers: Headers },
  ): ResponseSchema<Body, Status, Headers>;

  union: <Responses extends ReadonlyArray<ResponseSchema>>(
    ...responses: Responses
  ) => ResponseUnion<Responses>;
};

const createResponse = <
  Body extends Schema.Top,
  Status extends number = 200,
  Headers extends Record<string, Schema.Top> = {},
>(
  body: Body,
  options?: ResponseOptions<Status, Headers>,
): ResponseSchema<Body, Status, Headers> => ({
  [ResponseSchemaSymbol]: true,
  body,
  status: (options?.status ?? 200) as Status,
  headers: (options?.headers ?? {}) as Headers,
});

const createUnion = <Responses extends ReadonlyArray<ResponseSchema>>(
  ...responses: Responses
): ResponseUnion<Responses> => ({
  [ResponseUnionSymbol]: true,
  responses,
});

export const response: ResponseFn = Object.assign(createResponse, {
  union: createUnion,
}) as ResponseFn;

export const getResponseSchemas = (
  schema: AnyResponseSchema,
): ReadonlyArray<ResponseSchema> => {
  if (isResponseUnion(schema)) {
    return schema.responses;
  }
  return [schema];
};

export const getBodySchema = (schema: AnyResponseSchema): Schema.Top => {
  if (isResponseUnion(schema)) {
    if (schema.responses.length === 1) {
      return schema.responses[0]!.body;
    }
    return Schema.Union(schema.responses.map((r) => r.body));
  }
  return schema.body;
};

export const getStatuses = (
  schema: AnyResponseSchema,
): ReadonlyArray<number> => {
  if (isResponseUnion(schema)) {
    return schema.responses.map((r) => r.status);
  }
  return [schema.status];
};

export const getDefaultStatus = (schema: AnyResponseSchema): number => {
  if (isResponseUnion(schema)) {
    return schema.responses[0]?.status ?? 200;
  }
  return schema.status;
};

export const StreamBody = Schema.instanceOf(ReadableStream);

export const isStreamBody = (schema: Schema.Top): boolean => {
  if (schema === StreamBody) return true;
  if (schema.ast._tag === "Union") {
    const union = schema as Schema.Union<ReadonlyArray<Schema.Top>>;
    return union.members.some((member) => member === StreamBody);
  }
  return false;
};
