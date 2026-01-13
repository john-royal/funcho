import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  Contract,
  ContractService,
  Implementation,
  RouteDefinition,
  TypedResponse,
} from "./contract.js";
import { createTypedResponse, isTypedResponse } from "./contract.js";
import {
  MethodNotAllowedError,
  NotFoundError,
  ValidationError,
} from "./errors.js";
import {
  type CompiledRoute,
  compileContract,
  isRouteMatch,
  matchRoute,
  type RouteMatch,
} from "./router.js";
import {
  type AnyResponseSchema,
  getDefaultStatus,
  getResponseSchemas,
  isStreamBody,
} from "./schema.js";

export interface ErrorResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface FetchHandlerOptions {
  readonly formatError?: (error: unknown, request: Request) => ErrorResponse;
}

const defaultFormatError = (error: unknown): ErrorResponse => {
  if (error instanceof ValidationError) {
    return {
      status: 400,
      body: {
        error: "ValidationError",
        message: error.message,
        issues: error.issues,
      },
    };
  }
  if (error instanceof NotFoundError) {
    return {
      status: 404,
      body: { error: "NotFoundError", message: error.message },
    };
  }
  if (error instanceof MethodNotAllowedError) {
    return {
      status: 405,
      body: {
        error: "MethodNotAllowedError",
        message: error.message,
        allowed: error.allowed,
      },
    };
  }
  return {
    status: 500,
    body: {
      error: "InternalServerError",
      message: "An unexpected error occurred",
    },
  };
};

const decodeSchema = (
  schema: Schema.Top,
  value: unknown,
  errorMessage: string,
): Effect.Effect<unknown, ValidationError> =>
  Effect.try({
    try: () =>
      Schema.decodeUnknownSync(
        schema as Schema.Top & { readonly DecodingServices: never },
      )(value),
    catch: (err) =>
      new ValidationError({ message: errorMessage, issues: [err] }),
  });

const parseQuery = (
  url: URL,
  definition: RouteDefinition,
): Effect.Effect<Record<string, unknown>, ValidationError> =>
  Effect.gen(function* () {
    if (!definition.query) return {};
    const result: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(definition.query)) {
      const raw = url.searchParams.get(key);
      if (raw !== null) {
        result[key] = yield* decodeSchema(
          schema,
          raw,
          `Invalid query parameter: ${key}`,
        );
      }
    }
    return result;
  });

const parseHeaders = (
  headers: Headers,
  definition: RouteDefinition,
): Effect.Effect<Record<string, unknown>, ValidationError> =>
  Effect.gen(function* () {
    if (!definition.headers) return {};
    const result: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(definition.headers)) {
      const raw = headers.get(key);
      if (raw !== null) {
        result[key] = yield* decodeSchema(
          schema,
          raw,
          `Invalid header: ${key}`,
        );
      }
    }
    return result;
  });

const parsePath = (
  params: Record<string, string>,
  definition: RouteDefinition,
): Effect.Effect<Record<string, unknown>, ValidationError> =>
  Effect.gen(function* () {
    if (!definition.path) return params;
    const result: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(definition.path)) {
      const raw = params[key];
      if (raw !== undefined) {
        result[key] = yield* decodeSchema(
          schema,
          raw,
          `Invalid path parameter: ${key}`,
        );
      }
    }
    return result;
  });

const parseBody = (
  request: Request,
  definition: RouteDefinition,
): Effect.Effect<unknown, ValidationError> =>
  Effect.gen(function* () {
    if (!definition.body) return undefined;
    if (isStreamBody(definition.body)) {
      return request.body ?? null;
    }
    const text = yield* Effect.promise(() => request.text());
    if (!text) return undefined;
    const json = yield* Effect.try({
      try: () => JSON.parse(text),
      catch: () =>
        new ValidationError({ message: "Invalid JSON body", issues: [] }),
    });
    return yield* decodeSchema(definition.body, json, "Invalid request body");
  });

const serializeTypedResponse = (
  typed: TypedResponse<unknown, number, Record<string, unknown>>,
): Response => {
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(typed.headers)) {
    if (value !== undefined && value !== null) {
      responseHeaders.set(key, String(value));
    }
  }

  if (typed.body === undefined || typed.body === null) {
    return new Response(null, {
      status: typed.status,
      headers: responseHeaders,
    });
  }

  if (typed.body instanceof ReadableStream) {
    if (!responseHeaders.has("Content-Type")) {
      responseHeaders.set("Content-Type", "application/octet-stream");
    }
    return new Response(typed.body, {
      status: typed.status,
      headers: responseHeaders,
    });
  }

  if (!responseHeaders.has("Content-Type")) {
    responseHeaders.set("Content-Type", "application/json");
  }
  return new Response(JSON.stringify(typed.body), {
    status: typed.status,
    headers: responseHeaders,
  });
};

const createRespondFn = (definition: RouteDefinition) => {
  const defaultStatus = getDefaultStatus(definition.success);
  return (
    body: unknown,
    options?: { status?: number; headers?: Record<string, unknown> },
  ) =>
    createTypedResponse(
      body,
      options?.status ?? defaultStatus,
      options?.headers ?? {},
    );
};

const matchContractFailure = (
  error: unknown,
  failureSchema: AnyResponseSchema | undefined,
): TypedResponse<unknown, number, Record<string, unknown>> | null => {
  if (!failureSchema || !error || typeof error !== "object") return null;

  const schemas = getResponseSchemas(failureSchema);
  for (const schema of schemas) {
    // Check if error is an instance of the error class defined in the schema
    // For Schema.ErrorClass, the schema itself is the constructor
    const ErrorConstructor = schema.body as unknown as {
      new (...args: unknown[]): unknown;
    };
    if (error instanceof ErrorConstructor) {
      return createTypedResponse(error, schema.status, {});
    }
  }
  return null;
};

const handleRequest = <C extends Contract>(
  request: Request,
  routes: ReadonlyArray<CompiledRoute>,
  impl: Implementation<C>,
  options: FetchHandlerOptions,
): Effect.Effect<Response> => {
  const formatError = options.formatError ?? defaultFormatError;

  const url = new URL(request.url);
  const matchResult = matchRoute(routes, url.pathname, request.method);

  // Handle route not found or method not allowed
  if (!isRouteMatch(matchResult)) {
    if (matchResult.allowedMethods) {
      const error = new MethodNotAllowedError({
        message: `Method ${request.method} not allowed`,
        allowed: [...matchResult.allowedMethods],
      });
      const errorResponse = formatError(error, request);
      return Effect.succeed(
        new Response(JSON.stringify(errorResponse.body), {
          status: errorResponse.status,
          headers: {
            "Content-Type": "application/json",
            Allow: matchResult.allowedMethods.join(", "),
          },
        }),
      );
    }
    const error = new NotFoundError({ message: "Route not found" });
    const errorResponse = formatError(error, request);
    return Effect.succeed(
      new Response(JSON.stringify(errorResponse.body), {
        status: errorResponse.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  const match: RouteMatch = matchResult;
  const pathImpl = impl[match.route.pattern as keyof typeof impl];
  const methodImpl = pathImpl?.[match.method as keyof typeof pathImpl] as
    | ((ctx: unknown) => Effect.Effect<unknown, unknown>)
    | undefined;

  if (!methodImpl) {
    const error = new NotFoundError({ message: "Handler not found" });
    const errorResponse = formatError(error, request);
    return Effect.succeed(
      new Response(JSON.stringify(errorResponse.body), {
        status: errorResponse.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  const streamBody = isStreamBody(match.definition.body ?? Schema.Undefined)
    ? request.body
    : null;

  return Effect.gen(function* () {
    const [path, query, headers, body] = yield* Effect.all(
      [
        parsePath(match.params, match.definition),
        parseQuery(url, match.definition),
        parseHeaders(request.headers, match.definition),
        parseBody(request, match.definition),
      ],
      { concurrency: "unbounded" },
    );

    const context = {
      path,
      query,
      headers,
      body,
      respond: createRespondFn(match.definition),
    };

    const result = yield* methodImpl(context);

    if (isTypedResponse(result)) {
      return serializeTypedResponse(result);
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }).pipe(
    Effect.onExit((exit) => {
      if (exit._tag === "Failure" && streamBody && !streamBody.locked) {
        return Effect.promise(() => streamBody.cancel());
      }
      return Effect.void;
    }),
    Effect.catch((error: unknown) => {
      // Check if error matches a contract failure type
      const contractFailure = matchContractFailure(
        error,
        match.definition.failure,
      );
      if (contractFailure) {
        return Effect.succeed(serializeTypedResponse(contractFailure));
      }

      // Fall back to formatError for untyped errors
      const errorResponse = formatError(error, request);
      return Effect.succeed(
        new Response(JSON.stringify(errorResponse.body), {
          status: errorResponse.status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
};

export const FetchHandler = {
  from: <C extends Contract>(
    service: ContractService<C> & { readonly Contract: C },
    options: FetchHandlerOptions = {},
  ): Effect.Effect<
    (request: Request) => Promise<Response>,
    never,
    ContractService<C>
  > =>
    Effect.gen(function* () {
      const impl = yield* service;
      const routes = compileContract(service.Contract);
      return (request: Request): Promise<Response> =>
        Effect.runPromise(handleRequest(request, routes, impl, options));
    }),
};
