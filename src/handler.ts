import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  Contract,
  ContractService,
  Implementation,
  RouteDefinition,
} from "./contract.js";
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
import { getContentType, getHttpStatus, isStreamSchema } from "./schema.js";

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
  const httpStatus = getHttpStatusFromError(error);
  if (httpStatus) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      status: httpStatus,
      body: { error: error?.constructor?.name ?? "Error", message: msg },
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

const getHttpStatusFromError = (error: unknown): number | undefined => {
  if (error && typeof error === "object" && "constructor" in error) {
    const ctor = error.constructor;
    if (Schema.isSchema(ctor)) {
      const annotations = Schema.resolveInto(ctor as Schema.Top);
      if (annotations && typeof annotations.httpStatus === "number") {
        return annotations.httpStatus;
      }
    }
  }
  return undefined;
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
    if (isStreamSchema(definition.body)) {
      return request.body;
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

const serializeResponse = (
  value: unknown,
  definition: RouteDefinition,
): Response => {
  const status = getHttpStatus(definition.success) ?? 200;
  if (value instanceof ReadableStream) {
    const contentType =
      getContentType(definition.success) ?? "application/octet-stream";
    return new Response(value, {
      status,
      headers: { "Content-Type": contentType },
    });
  }
  if (value === undefined || value === null) {
    return new Response(null, { status: status === 200 ? 204 : status });
  }
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
};

const handleRequest = <C extends Contract>(
  request: Request,
  routes: ReadonlyArray<CompiledRoute>,
  impl: Implementation<C>,
  options: FetchHandlerOptions,
): Effect.Effect<Response> => {
  const formatError = options.formatError ?? defaultFormatError;
  return Effect.gen(function* () {
    const url = new URL(request.url);
    const matchResult = matchRoute(routes, url.pathname, request.method);
    if (!isRouteMatch(matchResult)) {
      if (matchResult.allowedMethods) {
        const error = new MethodNotAllowedError({
          message: `Method ${request.method} not allowed`,
          allowed: [...matchResult.allowedMethods],
        });
        const errorResponse = formatError(error, request);
        return new Response(JSON.stringify(errorResponse.body), {
          status: errorResponse.status,
          headers: {
            "Content-Type": "application/json",
            Allow: matchResult.allowedMethods.join(", "),
          },
        });
      }
      const error = new NotFoundError({ message: "Route not found" });
      const errorResponse = formatError(error, request);
      return new Response(JSON.stringify(errorResponse.body), {
        status: errorResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const match: RouteMatch = matchResult;
    const pathImpl = impl[match.route.pattern as keyof typeof impl];
    const methodImpl = pathImpl?.[match.method as keyof typeof pathImpl] as
      | ((ctx: unknown) => Effect.Effect<unknown, unknown>)
      | undefined;
    if (!methodImpl) {
      const error = new NotFoundError({ message: "Handler not found" });
      const errorResponse = formatError(error, request);
      return new Response(JSON.stringify(errorResponse.body), {
        status: errorResponse.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const context = yield* Effect.all(
      {
        path: parsePath(match.params, match.definition),
        query: parseQuery(url, match.definition),
        headers: parseHeaders(request.headers, match.definition),
        body: parseBody(request, match.definition),
      },
      { concurrency: "unbounded" },
    );
    const result = yield* methodImpl(context);
    return serializeResponse(result, match.definition);
  }).pipe(
    Effect.catch((error: unknown) => {
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
